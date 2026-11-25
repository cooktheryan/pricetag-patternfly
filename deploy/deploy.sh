#!/usr/bin/env bash
# Deploy the PriceTag SPA into the dedicated pricetag-patternfly namespace.
#
# The public host is resolved before the Route is applied: an existing Route
# supplies it, otherwise the cluster ingress domain does. The Deployment is
# rendered with that PUBLIC_ORIGIN and rolled out first; the Route is created
# only after the app is healthy, so it is never exposed without a backend.
set -euo pipefail

NS=pricetag-patternfly
IMAGE=${IMAGE:-quay.io/redhat-et/patternfly:pricetag-ui}
UPSTREAM=${UPSTREAM:-https://32.198.91.108:8443}
UPSTREAM_PUBLIC_ORIGIN=${UPSTREAM_PUBLIC_ORIGIN:-$UPSTREAM}
# Required: nginx cannot verify IP SANs, so this must be a DNS SAN on the
# gateway certificate. The preflight validates it before any cluster change.
UPSTREAM_TLS_NAME=${UPSTREAM_TLS_NAME:?set UPSTREAM_TLS_NAME to the gateway certificate DNS SAN}
CA_FILE=${CA_FILE:-$HOME/.config/praxis-pricetag/32.198.91.108/ca.pem}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/deploy/lib.sh"

certfile=""
rendered=""
routefile=""
netpol=""
blocks_file=""
prev_netpol=""
policy_pending=0
route_preexisting=0
route_touched=0
deploy_complete=0
cleanup() {
  if [ "${policy_pending:-0}" -eq 1 ] && type restore_prev_policy >/dev/null 2>&1; then
    restore_prev_policy
  fi
  [ -n "$certfile" ] && rm -f "$certfile"
  [ -n "$rendered" ] && rm -f "$rendered"
  [ -n "$routefile" ] && rm -f "$routefile"
  [ -n "$netpol" ] && rm -f "$netpol"
  [ -n "$blocks_file" ] && rm -f "$blocks_file"
  [ -n "$prev_netpol" ] && rm -f "$prev_netpol"
  # A Route created by this run must not stay exposed if the rollout or its
  # admission never completed; leave a pre-existing Route untouched.
  if [ "$route_touched" -eq 1 ] && [ "$route_preexisting" -eq 0 ] && [ "$deploy_complete" -ne 1 ]; then
    oc -n "$NS" delete route pricetag-patternfly --ignore-not-found >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "$IMAGE" in
  *[!A-Za-z0-9._/:@-]*) fail "IMAGE contains unsupported characters: $IMAGE" ;;
esac

validate_origin "$UPSTREAM" UPSTREAM
validate_origin "$UPSTREAM_PUBLIC_ORIGIN" UPSTREAM_PUBLIC_ORIGIN
validate_dns_name "$UPSTREAM_TLS_NAME" UPSTREAM_TLS_NAME

if [ ! -f "$CA_FILE" ]; then
  fail "missing gateway CA: $CA_FILE (set CA_FILE)"
fi
if ! openssl x509 -in "$CA_FILE" -noout >/dev/null 2>&1; then
  fail "CA_FILE is not a readable PEM certificate: $CA_FILE"
fi

# nginx verifies DNS SANs, not IP SANs. Confirm the chosen name is actually
# on the live certificate before rendering the manifest. Validation above
# guarantees a single host:port authority, so parse it explicitly.
case "$UPSTREAM" in
  https://*)
    authority=${UPSTREAM#https://}
    connect_host=${authority%%:*}
    connect_port=${authority##*:}
    [ "$connect_port" = "$authority" ] && connect_port=443
    cert=$(openssl s_client -connect "$connect_host:$connect_port" -servername "$UPSTREAM_TLS_NAME" \
      -CAfile "$CA_FILE" -verify_return_error \
      </dev/null 2>/dev/null | openssl x509 2>/dev/null || true)
    [ -n "$cert" ] || fail "could not read the upstream certificate from $connect_host:$connect_port"

    certfile=$(mktemp "${TMPDIR:-/tmp}/pricetag-cert.XXXXXX")
    printf '%s\n' "$cert" > "$certfile"
    # Checks the chain, validity window, and DNS SAN/hostname (including
    # wildcard matching) against the same CA and name nginx will use.
    if ! openssl verify -CAfile "$CA_FILE" -verify_hostname "$UPSTREAM_TLS_NAME" "$certfile" >/dev/null 2>&1; then
      fail "upstream certificate does not chain to $CA_FILE or does not match $UPSTREAM_TLS_NAME"
    fi
    rm -f "$certfile"
    certfile=""
    ;;
esac

oc apply -f "$ROOT/deploy/k8s/namespace.yaml"
oc -n "$NS" apply -f "$ROOT/deploy/k8s/service.yaml"
# The nginx/CA applies happen after the NetworkPolicy render validates below,
# so a bad upstream/label cannot leave half-updated resources behind.
# Render the NetworkPolicy's gateway egress from the same UPSTREAM the proxy
# uses. Resolve every IPv4 so nginx's runtime choice is always covered, and
# verify the standard OpenShift router policy-group label before relying on it.
ingress_group=$(oc get namespace openshift-ingress -o jsonpath='{.metadata.labels.network\.openshift\.io/policy-group}' 2>/dev/null || true)
[ "$ingress_group" = "ingress" ] || fail "NetworkPolicy expects openshift-ingress to carry network.openshift.io/policy-group=ingress"
# validate_origin (above) accepts only scheme://host[:port], so no credentials,
# path, query, or IPv6 literal can reach this parse.
case "$UPSTREAM" in
  https://*) default_port=443 ;;
  http://*) default_port=80 ;;
  *) fail "unsupported UPSTREAM scheme" ;;
esac
authority=${UPSTREAM#*://}
upstream_host=${authority%%:*}
upstream_port=${authority##*:}
[ "$upstream_port" = "$authority" ] && upstream_port=$default_port
case "$upstream_port" in
  ''|*[!0-9]*) fail "UPSTREAM port must be a decimal integer" ;;
esac
if [ "$upstream_port" -lt 1 ] || [ "$upstream_port" -gt 65535 ]; then
  fail "UPSTREAM port must be between 1 and 65535"
fi
# The NetworkPolicy needs concrete egress targets: a literal IPv4 or every A
# record the hostname currently publishes. Private/internal gateways are
# valid; loopback, link-local (metadata), and the unspecified address are
# rejected. DNS rotation requires re-running this deploy.
is_ipv4() {
  case "$1" in
    ''|*[!0-9.]*|.*|*.|*..*) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  set -- $1
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for octet in "$@"; do
    [ -n "$octet" ] || return 1
    [ "$octet" -ge 0 ] 2>/dev/null && [ "$octet" -le 255 ] 2>/dev/null || return 1
  done
  return 0
}
GATEWAY_PORT="$upstream_port"
dns_ip=$(oc -n openshift-dns get svc dns-default -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
[ -n "$dns_ip" ] || fail "could not determine the cluster DNS service IP for the NetworkPolicy"
DNS_CIDR="$dns_ip/32"
# Resolve every IPv4 address the hostname currently publishes. A Kubernetes
# NetworkPolicy cannot follow DNS rotation, so re-run this deploy if the
# gateway's records change; for a literal address this is a single /32.
if is_ipv4 "$upstream_host"; then
  gateway_ips="$upstream_host"
else
  gateway_ips=""
  if command -v getent >/dev/null 2>&1; then
    gateway_ips=$(getent ahostsv4 "$upstream_host" 2>/dev/null | awk '$2 == "STREAM" { print $1 }' | sort -u)
  fi
  if [ -z "$gateway_ips" ]; then
    gateway_ips=$(python3 - "$upstream_host" <<'PY'
import socket, sys
try:
    infos = socket.getaddrinfo(sys.argv[1], None, socket.AF_INET, socket.SOCK_STREAM)
except OSError:
    sys.exit(1)
seen = []
for info in infos:
    ip = info[4][0]
    if ip not in seen:
        seen.append(ip)
if not seen:
    sys.exit(1)
print("\n".join(seen))
PY
    ) || fail "could not resolve $upstream_host for the NetworkPolicy"
  fi
fi
[ -n "$gateway_ips" ] || fail "could not resolve $upstream_host for the NetworkPolicy"
GATEWAY_BLOCKS=""
for gateway_ip in $gateway_ips; do
  case "$gateway_ip" in
    0.*|127.*|169.254.*)
      fail "UPSTREAM resolves to the unspecified, loopback, or link-local address $gateway_ip"
      ;;
  esac
  printf -v GATEWAY_BLOCKS '%s        - ipBlock:\n            cidr: %s/32\n' "$GATEWAY_BLOCKS" "$gateway_ip"
done
netpol=$(mktemp "${TMPDIR:-/tmp}/pricetag-networkpolicy.XXXXXX")
blocks_file=$(mktemp "${TMPDIR:-/tmp}/pricetag-netpol-blocks.XXXXXX")
printf '%s\n' "$GATEWAY_BLOCKS" > "$blocks_file"
if ! awk -v blockfile="$blocks_file" -v port="$GATEWAY_PORT" -v dns="$DNS_CIDR" '
  $0 == "__GATEWAY_BLOCKS__" {
    while ((getline line < blockfile) > 0) print line
    close(blockfile)
    next
  }
  {
    gsub(/[$][{]GATEWAY_PORT[}]/, port)
    gsub(/[$][{]DNS_CIDR[}]/, dns)
    print
  }
' "$ROOT/deploy/k8s/networkpolicy.yaml" > "$netpol"; then
  fail "could not render the NetworkPolicy"
fi
rm -f "$blocks_file"
blocks_file=""
if grep -q '\${' "$netpol" || grep -q '__GATEWAY_BLOCKS__' "$netpol"; then
  fail "unrendered placeholder in the NetworkPolicy"
fi
oc -n "$NS" apply -f "$ROOT/deploy/k8s/nginx-config.yaml"
# The bundle carries the public Praxis test CA so a raw apply is complete;
# the live update below refreshes it from CA_FILE.
oc -n "$NS" apply -f "$ROOT/deploy/k8s/gateway-ca.yaml"

# Applied after the rollout below, so an upgrade that fails before the new
# pods are healthy cannot leave the serving pods restricted.

if ! oc -n "$NS" get service pricetag-patternfly >/dev/null; then
  fail "service pricetag-patternfly was not created"
fi

# The CA is public, but it is environment-specific: create the ConfigMap from
# the running gateway instead of committing it. The Deployment mounts it, so
# fail before applying the Deployment if it is missing.
oc -n "$NS" create configmap pricetag-gateway-ca \
  --from-file=ca.crt="$CA_FILE" \
  --dry-run=client -o yaml | oc apply -f -

if ! oc -n "$NS" get configmap pricetag-gateway-ca >/dev/null; then
  fail "configmap pricetag-gateway-ca was not created"
fi

# Resolve the public host before any Route mutation. An existing Route keeps
# its host (and is never re-applied); a fresh install uses the standard
# OpenShift generated host from the cluster ingress domain.
if oc -n "$NS" get route pricetag-patternfly >/dev/null 2>&1; then
  route_preexisting=1
  HOST=$(oc -n "$NS" get route pricetag-patternfly -o jsonpath='{.spec.host}')
  [ -n "$HOST" ] || fail "existing route pricetag-patternfly has no host"
else
  DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
  [ -n "$DOMAIN" ] || fail "could not determine the cluster ingress domain"
  HOST="pricetag-patternfly-${NS}.${DOMAIN}"
fi
PUBLIC_ORIGIN="https://$HOST"
validate_origin "$PUBLIC_ORIGIN" PUBLIC_ORIGIN

rendered=$(mktemp "${TMPDIR:-/tmp}/pricetag-deployment.XXXXXX")

# Longest placeholder first so no substitution can be a prefix of another.
sed \
  -e "s|\${UPSTREAM_PUBLIC_ORIGIN}|$(escape_sed "$UPSTREAM_PUBLIC_ORIGIN")|g" \
  -e "s|\${UPSTREAM}|$(escape_sed "$UPSTREAM")|g" \
  -e "s|\${IMAGE}|$(escape_sed "$IMAGE")|g" \
  -e "s|\${PUBLIC_ORIGIN}|$(escape_sed "$PUBLIC_ORIGIN")|g" \
  -e "s|\${UPSTREAM_TLS_NAME}|$(escape_sed "$UPSTREAM_TLS_NAME")|g" \
  "$ROOT/deploy/k8s/deployment.yaml" > "$rendered"

if grep -q '\${' "$rendered"; then
  fail "unrendered placeholder in the Deployment"
fi

oc -n "$NS" apply -f "$rendered"
# Mutable tags (the internal registry's :latest, or the Quay tag) need an
# explicit restart; the Deployment spec does not change when the tag moves.
oc -n "$NS" rollout restart deployment/pricetag-patternfly >/dev/null
oc -n "$NS" rollout status deployment/pricetag-patternfly --timeout=240s

# Apply the ingress/egress policy only after the new pods are healthy. Keep
# the previous policy so a failed apply cannot leave the new pods restricted.
prev_netpol=$(mktemp "${TMPDIR:-/tmp}/pricetag-prev-netpol.XXXXXX")
if ! oc -n "$NS" get networkpolicy pricetag-patternfly -o yaml > "$prev_netpol" 2>/dev/null; then
  rm -f "$prev_netpol"
  prev_netpol=""
  if oc -n "$NS" get networkpolicy pricetag-patternfly -o name >/dev/null 2>&1; then
    fail "could not read the existing NetworkPolicy; refusing to change it"
  fi
  missing=$(oc -n "$NS" get networkpolicy pricetag-patternfly -o name 2>&1 || true)
  case "$missing" in
    *NotFound*|*"not found"*) ;;
    *) fail "could not determine whether the NetworkPolicy exists; refusing to change it" ;;
  esac
fi
restore_prev_policy() {
  policy_pending=0
  if [ -n "$prev_netpol" ]; then
    if ! oc apply -f "$prev_netpol" >/dev/null 2>&1; then
      if ! oc replace --force -f "$prev_netpol" >/dev/null 2>&1; then
        echo "warning: could not restore the previous NetworkPolicy; leaving the current policy in place" >&2
        return 1
      fi
    fi
  else
    echo "warning: no previous NetworkPolicy to restore; leaving the current policy in place" >&2
    return 1
  fi
  return 0
}
policy_pending=1
if ! oc -n "$NS" apply -f "$netpol"; then
  restore_prev_policy
  fail "NetworkPolicy apply failed"
fi
# The API can accept a policy whose selector no longer matches the pods, or
# that blocks the gateway. Verify the selector and let a fresh probe cycle run
# before declaring success; roll back on failure.
selector_label=$(oc -n "$NS" get deploy pricetag-patternfly -o jsonpath='{.spec.template.metadata.labels.app\.kubernetes\.io/name}' 2>/dev/null || true)
if [ "$selector_label" != "pricetag-patternfly" ]; then
  restore_prev_policy
  fail "NetworkPolicy selector does not match the Deployment pods"
fi
sleep 12
ready_count=$(oc -n "$NS" get pods -l app.kubernetes.io/name=pricetag-patternfly -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null | grep -c '^True$' || true)
if [ "${ready_count:-0}" -lt 1 ]; then
  restore_prev_policy
  fail "NetworkPolicy blocked the app"
fi

# Expose the app only after the Deployment is ready.
if [ "$route_preexisting" -eq 0 ]; then
  routefile=$(mktemp "${TMPDIR:-/tmp}/pricetag-route.XXXXXX")
  sed -e "s|\${PUBLIC_HOST}|$(escape_sed "$HOST")|g" \
    "$ROOT/deploy/k8s/route.yaml" > "$routefile"
  if grep -q '\${' "$routefile"; then
    fail "unrendered placeholder in the Route"
  fi
  oc -n "$NS" apply -f "$routefile"
  route_touched=1
  rm -f "$routefile"
  routefile=""

  admitted=""
  for _ in $(seq 1 30); do
    admitted=$(oc -n "$NS" get route pricetag-patternfly \
      -o jsonpath='{.status.ingress[0].conditions[?(@.type=="Admitted")].status}' 2>/dev/null || true)
    [ "$admitted" = "True" ] && break
    sleep 2
  done
  [ "$admitted" = "True" ] || fail "route pricetag-patternfly was not admitted"
fi

curl -fsSk --max-time 10 "$PUBLIC_ORIGIN/login" >/dev/null || fail "Route smoke check failed"

# /login is static SPA HTML; it proves ingress but not the gateway path. An
# unauthenticated /whoami must come back from the gateway (200/302/401/403);
# a 502/504/000 means the NetworkPolicy or upstream is blocking it.
whoami_status=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_ORIGIN/whoami" || true)
case "$whoami_status" in
  200|302|401|403) ;;
  *)
    fail "gateway-backed Route check failed (/whoami HTTP ${whoami_status:-none})"
    ;;
esac

policy_pending=0
rm -f "$prev_netpol"
prev_netpol=""
rm -f "$netpol"
netpol=""
deploy_complete=1
echo
echo "Deployed: $PUBLIC_ORIGIN"
