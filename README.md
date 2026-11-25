# enmaas-patternfly

PatternFly 6 rebuild of the PriceTag metering UI with Red Hat branding.

Spec and plan: `specs/001-pricetag-patternfly/`.

## Stack

- Vite 8 + React 19 + TypeScript
- PatternFly 6 (`@patternfly/react-core`, `react-table`, `react-charts`,
  `react-icons`)
- react-router, URL space mirroring the legacy gateway

## Develop

```sh
npm install
npm run dev        # http://localhost:5173 (loopback only)
```

The dev server proxies `/api`, `/whoami`, `/login`, `/logout`,
`/admin/impersonate` (and friends) to the upstream PriceTag gateway.

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UPSTREAM` | `http://127.0.0.1:8080` | Gateway the proxy forwards to |
| `UPSTREAM_PUBLIC_ORIGIN` | `http://localhost:8080` | Origin the gateway's CSRF check expects (`MANAGEMENT_PUBLIC_ORIGIN`) |
| `UPSTREAM_INSECURE` | unset | Set `1` only for the self-signed live gateway |

### Local standalone stack

```sh
cd ~/git/pricetag-metering
podman compose -f docker-compose.standalone.yaml up --build -d
COMPOSE_PROJECT_NAME=pricetag-metering \
  bash <(sed 's/docker compose/podman compose/g' tools/local/bootstrap.sh)
```

Seeded login keys: `local-admin-key` (super admin), `local-test-user-key`,
`local-returning-key`.

### Live gateway (read-only)

```sh
UPSTREAM=https://32.198.91.108:8443 \
UPSTREAM_PUBLIC_ORIGIN=https://32.198.91.108:8443 \
UPSTREAM_INSECURE=1 \
npm run dev
```

Never run destructive flows (key create/revoke, admin writes) against the
live gateway.

## Build

```sh
npm run build      # typecheck + production bundle in dist/
npx oxlint         # lint
```

## Deploy

The SPA runs as an unprivileged nginx container (SPA plus same-origin
gateway proxy) in the emerg cluster namespace `pricetag-patternfly`:

- Route: <https://pricetag-patternfly-pricetag-patternfly.apps.emerg.pcbk.p1.openshiftapps.com>
- Intended image: `quay.io/redhat-et/patternfly:pricetag-ui`
- Build and deployment details: `deploy/README.md`

The current rollout pulls from the cluster's internal registry because the
`redhat-et+enmaas` robot has pull-only access to the Quay repository. Once
Write is granted, push the image and re-run `deploy/deploy.sh` with
`IMAGE=quay.io/redhat-et/patternfly:pricetag-ui`.
