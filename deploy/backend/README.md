# PriceTag backend

The in-cluster backend for the PriceTag PatternFly UI (`pricetag-patternfly`
namespace): the UI's nginx proxy targets this stack's metering-service
instead of the retired external gateway at `32.198.91.108:8443`.

Layout mirrors the EnMaaS-opps `base/projects/enmaas` templates and the
proven `enmaas-mocker` stack, with the OpenAI provider wired in from
EnMaaS-opps production (`credential_injection` + `OPENAI_API_KEY`):

| Component | Image | Role |
|-----------|-------|------|
| `postgres` | `docker.io/library/postgres:16` (digest-pinned) | One `pricetag` database shared by maas-api and metering |
| `maas-api` | `quay.io/redhat-et/enmaas-api:main` (digest-pinned) | API-key minting/validation (`/internal/v1/api-keys/validate`) |
| `metering-service` | built in-cluster from `pricetag-metering` source | The management API the UI proxies to (`/whoami`, `/login`, `/api/v1/*`) |
| `praxis` | `quay.io/redhat-et/praxis-ai:main` (digest-pinned) | Public AI gateway (`api-pricetag-backend.<domain>`), OpenAI-compatible, meters every request |
| `bootstrap` | Job | Seeds admin/alice/bob identities + keys, dashboard roles, and model pricing |

## Deploy

```sh
deploy/backend/deploy.sh
```

Prerequisites:

- `oc` logged in to the cluster, with the UI already deployed (its Route
  origin becomes metering's `MANAGEMENT_PUBLIC_ORIGIN`, which the
  logout/impersonate CSRF check compares against).
- `~/.codex/auth.json` containing an `OPENAI_API_KEY` (override with
  `OPENAI_AUTH_JSON`).
- The `pricetag-metering` checkout at `~/git/pricetag-metering` (override
  with `METERING_SOURCE_DIR`). The image is built with an OpenShift
  BuildConfig (binary build) into the internal registry, so no local
  container runtime is needed.

The script is idempotent: random secrets are minted once and never rotated,
the OpenAI credential is re-synced from the auth file each run, the bootstrap
job reuses already-saved keys, and the UI is re-pointed at the new metering
upstream at the end (its egress NetworkPolicy uses a destination selector —
`UPSTREAM_EGRESS_NAMESPACE`/`UPSTREAM_EGRESS_APP` — because OVN enforces
`ipBlock` egress rules against the post-NAT backend pod, so a ClusterIP /32
never matches pod-to-Service traffic).

Environment knobs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_AUTH_JSON` | `~/.codex/auth.json` | Source of `OPENAI_API_KEY` |
| `METERING_SOURCE_DIR` | `~/git/pricetag-metering` | Source for the binary image build |
| `CA_FILE` | `~/.config/praxis-pricetag/32.198.91.108/ca.pem` | Only used for the UI re-point (inert for the plain-HTTP upstream) |
| `REPOINT_UI` | `1` | Re-point the PatternFly UI at the new metering upstream |
| `SMOKE_INFERENCE` | `1` | Send one tiny completion through the gateway to verify the OpenAI credential |

## Client keys

The bootstrap job mints one-time keys into `Secret/client-keys`:

```sh
oc -n pricetag-backend get secret client-keys -o jsonpath='{.data.admin\.json}' | base64 -d | jq -r .key
```

`admin` is a partner super-admin (dashboard, `/admin` console, and
impersonation); `alice` and `bob` are regular users.
Use the admin key to log in at the UI's `/login`, and as the `Authorization:
Bearer` credential against the gateway.

## Gateway

`https://api-pricetag-backend.<ingress-domain>` exposes the OpenAI-compatible
endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/models`); Anthropic
`/v1/messages` is not routable because the deployment has no Anthropic-native
upstream. Routed models are defined in the `praxis-routing-*` ConfigMaps and
pricing in the `model-pricing.sql` the bootstrap job applies; both can be
adjusted and re-run.

## Teardown

```sh
oc delete namespace pricetag-backend
```

Re-point the UI elsewhere by re-running `deploy/deploy.sh` with a different
`UPSTREAM` (see that script's header).
