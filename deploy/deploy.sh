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
route_preexisting=0
route_touched=0
deploy_complete=0
cleanup() {
  [ -n "$certfile" ] && rm -f "$certfile"
  [ -n "$rendered" ] && rm -f "$rendered"
  [ -n "$routefile" ] && rm -f "$routefile"
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
oc -n "$NS" apply -f "$ROOT/deploy/k8s/nginx-config.yaml"
# The bundle carries the public Praxis test CA so a raw apply is complete;
# the live update below refreshes it from CA_FILE.
oc -n "$NS" apply -f "$ROOT/deploy/k8s/gateway-ca.yaml"

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

deploy_complete=1
echo
echo "Deployed: $PUBLIC_ORIGIN"
