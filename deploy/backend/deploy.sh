#!/usr/bin/env bash
# Deploy the PriceTag backend stack into the pricetag-backend namespace:
# Postgres, maas-api (API-key service), metering-service (the management API
# the PatternFly UI proxies to), and praxis (the AI gateway fronting OpenAI),
# then bootstrap the initial identities and client keys.
#
# Idempotent: random secrets are minted once and never rotated by re-runs, the
# OpenAI credential is re-synced from the local auth file each run, and the
# bootstrap job reuses already-saved keys. The metering image is rebuilt from
# METERING_SOURCE_DIR on every run.
#
# After the stack is healthy the PatternFly UI is re-pointed at the new
# metering upstream (disable with REPOINT_UI=0). A single smoke completion is
# sent through the gateway to verify the OpenAI credential end to end
# (disable with SMOKE_INFERENCE=0).
set -euo pipefail

NS=pricetag-backend
OPENAI_AUTH_JSON=${OPENAI_AUTH_JSON:-$HOME/.codex/auth.json}
METERING_SOURCE_DIR=${METERING_SOURCE_DIR:-$HOME/git/pricetag-metering}
CA_FILE=${CA_FILE:-$HOME/.config/praxis-pricetag/32.198.91.108/ca.pem}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BACKEND=$ROOT/deploy/backend
. "$ROOT/deploy/lib.sh"

for tool in jq openssl curl base64; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing required tool: $tool"
done

[ -f "$OPENAI_AUTH_JSON" ] || fail "missing OpenAI credential file: $OPENAI_AUTH_JSON (set OPENAI_AUTH_JSON)"
openai_key=$(jq -r 'if (type == "object" and has("OPENAI_API_KEY") and (.OPENAI_API_KEY | type == "string")) then .OPENAI_API_KEY else "" end' "$OPENAI_AUTH_JSON")
[ -n "$openai_key" ] || fail "no OPENAI_API_KEY string in $OPENAI_AUTH_JSON"
[ -f "$METERING_SOURCE_DIR/Dockerfile" ] || fail "missing Dockerfile in $METERING_SOURCE_DIR (set METERING_SOURCE_DIR)"
[ -f "$CA_FILE" ] || fail "missing CA bundle: $CA_FILE (set CA_FILE; only used for the UI re-point)"

# The UI Route origin is what metering's logout/impersonate CSRF check compares
# the (rewritten) Origin header against, and what the UI proxy rewrites the
# browser Origin to via UPSTREAM_PUBLIC_ORIGIN.
UI_NS=pricetag-patternfly
UI_HOST=$(oc -n "$UI_NS" get route pricetag-patternfly -o jsonpath='{.spec.host}' 2>/dev/null) || fail "UI route not found in $UI_NS; deploy the UI first (deploy/deploy.sh)"
[ -n "$UI_HOST" ] || fail "UI route has no host"
MANAGEMENT_PUBLIC_ORIGIN="https://$UI_HOST"
validate_origin "$MANAGEMENT_PUBLIC_ORIGIN" MANAGEMENT_PUBLIC_ORIGIN

DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
[ -n "$DOMAIN" ] || fail "could not determine the cluster ingress domain"
GATEWAY_HOST="api-pricetag-backend.$DOMAIN"
GATEWAY_URL="https://$GATEWAY_HOST"
validate_origin "$GATEWAY_URL" GATEWAY_URL

render() {
  out=$(mktemp "${TMPDIR:-/tmp}/pricetag-backend-render.XXXXXX")
  sed \
    -e "s|\${MANAGEMENT_PUBLIC_ORIGIN}|$(escape_sed "$MANAGEMENT_PUBLIC_ORIGIN")|g" \
    -e "s|\${GATEWAY_URL}|$(escape_sed "$GATEWAY_URL")|g" \
    -e "s|\${GATEWAY_HOST}|$(escape_sed "$GATEWAY_HOST")|g" \
    "$1" > "$out" || { rm -f "$out"; fail "could not render $1"; }
  if grep -q '\${' "$out"; then
    rm -f "$out"
    fail "unrendered placeholder in $1"
  fi
  printf '%s' "$out"
}

# Rendered manifests reference secrets; never leave them behind on failure.
cleanup_files=()
cleanup() {
  [ ${#cleanup_files[@]} -eq 0 ] || rm -f -- "${cleanup_files[@]}"
}
trap cleanup EXIT

oc apply -f "$BACKEND/namespace.yaml"

# --- Secrets -----------------------------------------------------------------
# Random values are minted once; re-runs keep them, because rotating the
# database password or the service tokens in place would break a live stack.
if ! oc -n "$NS" get secret postgres-credentials >/dev/null 2>&1; then
  oc -n "$NS" create secret generic postgres-credentials \
    --from-literal=password="$(openssl rand -hex 24)" >/dev/null
fi
if ! oc -n "$NS" get secret maas-db-config >/dev/null 2>&1; then
  db_password=$(oc -n "$NS" get secret postgres-credentials -o jsonpath='{.data.password}' | base64 -d)
  # Percent-encode the password (via stdin, so no argv parsing applies) so a
  # pre-existing secret with URI-reserved characters still produces a correct
  # connection string.
  db_password_encoded=$(printf '%s' "$db_password" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')
  oc -n "$NS" create secret generic maas-db-config \
    --from-literal=DB_CONNECTION_URL="postgresql://pricetag:${db_password_encoded}@postgres:5432/pricetag?sslmode=disable" >/dev/null
fi
if ! oc -n "$NS" get secret service-auth >/dev/null 2>&1; then
  oc -n "$NS" create secret generic service-auth \
    --from-literal=session-secret="$(openssl rand -hex 32)" \
    --from-literal=metering-token="$(openssl rand -hex 24)" \
    --from-literal=management-token="$(openssl rand -hex 24)" \
    --from-literal=model-policy-token="$(openssl rand -hex 24)" \
    --from-literal=usage-report-token="$(openssl rand -hex 24)" \
    --from-literal=model-catalog-token="$(openssl rand -hex 24)" >/dev/null
fi
# praxis presents service-auth/metering-token to the metering ingest API.
if ! oc -n "$NS" get secret metering-internal-auth >/dev/null 2>&1; then
  oc -n "$NS" create secret generic metering-internal-auth \
    --from-literal=token="$(oc -n "$NS" get secret service-auth -o jsonpath='{.data.metering-token}' | base64 -d)" >/dev/null
fi
# The provider credential always follows the local auth file, so key rotation
# only needs a re-run.
oc -n "$NS" create secret generic provider-credentials \
  --from-literal=OPENAI_API_KEY="$openai_key" \
  --dry-run=client -o yaml | oc apply -f - >/dev/null

# --- Database and key service -------------------------------------------------
oc -n "$NS" apply -f "$BACKEND/postgres.yaml"
oc -n "$NS" rollout status deployment/postgres --timeout=420s
oc -n "$NS" apply -f "$BACKEND/maas-api.yaml"
oc -n "$NS" rollout status deployment/maas-api --timeout=420s

# --- metering-service image (in-cluster build) --------------------------------
oc -n "$NS" apply -f "$BACKEND/metering-build.yaml"
# Human-readable start-build output differs across clients; instead require
# the BuildConfig's lastVersion to advance past the value observed before the
# build was submitted, then monitor the build that version names.
build_version_before=$(oc -n "$NS" get buildconfig metering-service -o jsonpath='{.status.lastVersion}')
case "$build_version_before" in
  ''|*[!0-9]*) build_version_before=0 ;;
esac
oc -n "$NS" start-build metering-service --from-dir="$METERING_SOURCE_DIR" >/dev/null
# The build controller advances lastVersion as part of naming the Build, but
# retry the read briefly in case the updated value is not immediately
# observable after start-build returns.
build_version=""
for _ in $(seq 1 6); do
  candidate=$(oc -n "$NS" get buildconfig metering-service -o jsonpath='{.status.lastVersion}')
  case "$candidate" in
    ''|*[!0-9]*) ;;
    *) if [ "$build_version_before" -lt "$candidate" ]; then build_version="$candidate"; fi ;;
  esac
  [ -n "$build_version" ] && break
  sleep 2
done
[ -n "$build_version" ] || fail "metering-service build did not start (lastVersion did not advance past $build_version_before)"
build="build/metering-service-$build_version"
echo "Building metering-service image ($build)"
# `oc get` exits non-zero for a missing object, but jsonpath output can still
# be an empty string for an existing object; verify the Build exists once up
# front so the poll below only ever waits on a real (initializing) Build.
oc -n "$NS" get "$build" >/dev/null 2>&1 || fail "build object $build not found after start-build"
phase=""
for _ in $(seq 1 180); do
  # An empty phase is normal while the build controller initializes the Build;
  # an oc failure (missing build, auth error) must not be retried for 15 minutes.
  if ! phase=$(oc -n "$NS" get "$build" -o jsonpath='{.status.phase}' 2>/dev/null); then
    fail "could not read status of $build"
  fi
  case "$phase" in
    Complete) break ;;
    Failed|Error|Cancelled)
      oc -n "$NS" logs "$build" 2>/dev/null | tail -40 >&2 || true
      fail "metering-service image build failed (phase: $phase)"
      ;;
  esac
  sleep 5
done
[ "$phase" = Complete ] || fail "metering-service image build timed out"

# --- metering-service and praxis ----------------------------------------------
oc -n "$NS" apply -f "$BACKEND/praxis-config.yaml"
rendered_metering=$(render "$BACKEND/metering-service.yaml")
cleanup_files+=("$rendered_metering")
oc -n "$NS" apply -f "$rendered_metering"
rm -f "$rendered_metering"
# Mutable :latest tag: force a pull even when the Deployment spec is unchanged.
oc -n "$NS" rollout restart deployment/metering-service >/dev/null
oc -n "$NS" rollout status deployment/metering-service --timeout=420s

rendered_praxis=$(render "$BACKEND/praxis.yaml")
cleanup_files+=("$rendered_praxis")
oc -n "$NS" apply -f "$rendered_praxis"
rm -f "$rendered_praxis"
# Env vars are fixed at container start, so a re-synced provider credential
# only takes effect after a restart; otherwise rollout status reports the
# unchanged pods and the smoke test validates the stale key.
oc -n "$NS" rollout restart deployment/praxis >/dev/null
oc -n "$NS" rollout status deployment/praxis --timeout=420s

# --- NetworkPolicies (after the pods are healthy) ------------------------------
oc -n "$NS" apply -f "$BACKEND/networkpolicies.yaml"
sleep 12
for deployment in postgres maas-api metering-service praxis; do
  ready=$(oc -n "$NS" get deployment "$deployment" -o jsonpath='{.status.readyReplicas}')
  [ "${ready:-0}" -ge 1 ] || fail "NetworkPolicy appears to block deployment/$deployment"
done

# --- Bootstrap identities, keys, roles, pricing --------------------------------
if oc -n "$NS" get job bootstrap >/dev/null 2>&1; then
  oc -n "$NS" delete job bootstrap --wait >/dev/null
fi
oc -n "$NS" apply -f "$BACKEND/bootstrap.yaml"
boot_ok=0
for _ in $(seq 1 120); do
  succeeded=$(oc -n "$NS" get job bootstrap -o jsonpath='{.status.succeeded}' 2>/dev/null || echo 0)
  if [ "${succeeded:-0}" -ge 1 ]; then
    boot_ok=1
    break
  fi
  failed=$(oc -n "$NS" get job bootstrap -o jsonpath='{.status.failed}' 2>/dev/null || echo 0)
  if [ "${failed:-0}" -ge 3 ]; then
    oc -n "$NS" logs job/bootstrap -c provision 2>/dev/null | tail -30 >&2 || true
    oc -n "$NS" logs job/bootstrap -c dashboard-roles 2>/dev/null | tail -10 >&2 || true
    fail "bootstrap job failed"
  fi
  sleep 5
done
[ "$boot_ok" = 1 ] || fail "bootstrap job timed out"

# --- Gateway checks -------------------------------------------------------------
curl -fsS --max-time 10 "$GATEWAY_URL/health" >/dev/null || fail "gateway health check failed"

admin_key=$(oc -n "$NS" get secret client-keys -o jsonpath='{.data.admin\.json}' | base64 -d | jq -r .key)
[ -n "$admin_key" ] || fail "admin key was not persisted to Secret/client-keys"
models_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -H "Authorization: Bearer $admin_key" "$GATEWAY_URL/v1/models" || true)
[ "$models_status" = 200 ] || fail "gateway model list failed (HTTP ${models_status:-none}); check maas-api validation and metering health"

# --- Re-point the UI ------------------------------------------------------------
if [ "${REPOINT_UI:-1}" = 1 ]; then
  metering_ip=$(oc -n "$NS" get svc metering-service -o jsonpath='{.spec.clusterIP}')
  [ -n "$metering_ip" ] || fail "could not resolve the metering ClusterIP"
  UPSTREAM="http://$metering_ip:8080" \
  ALLOW_PRIVATE_UPSTREAM=1 \
  UPSTREAM_PUBLIC_ORIGIN="$MANAGEMENT_PUBLIC_ORIGIN" \
  UPSTREAM_TLS_NAME=localhost \
  CA_FILE="$CA_FILE" \
  UPSTREAM_EGRESS_NAMESPACE="$NS" \
  UPSTREAM_EGRESS_APP=metering-service \
  "$ROOT/deploy/deploy.sh"
fi

# --- End-to-end inference check (gating; disable with SMOKE_INFERENCE=0) -------
# Runs after the UI re-point so a provider-side hiccup never leaves the UI
# pointed at the previous upstream. This is the only check that exercises the
# configured credential and the externally routed inference path, so it fails
# the deployment rather than warning: a green run must mean inference works.
if [ "${SMOKE_INFERENCE:-1}" = 1 ]; then
  echo "Sending one smoke completion through the gateway"
  smoke=$(curl -s --max-time 120 -w '\n%{http_code}' \
    -H "Authorization: Bearer $admin_key" -H 'Content-Type: application/json' \
    -d '{"model":"gpt-5.4","max_completion_tokens":16,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}' \
    "$GATEWAY_URL/v1/chat/completions" || true)
  smoke_code=$(printf '%s\n' "$smoke" | tail -1)
  if [ "$smoke_code" = 200 ]; then
    echo "Smoke completion OK (HTTP 200)"
  else
    printf '%s\n' "$smoke" | sed '$d' | head -c 400 >&2 || true
    echo >&2
    fail "smoke completion returned HTTP ${smoke_code:-none}; check the OpenAI credential and model availability (skip with SMOKE_INFERENCE=0)"
  fi
fi

echo
echo "Backend deployed in namespace $NS"
echo "  AI gateway: $GATEWAY_URL (models: gpt-5.4, gpt-5.3-codex)"
echo "  Admin key:  oc -n $NS get secret client-keys -o jsonpath='{.data.admin\.json}' | base64 -d | jq -r .key"
