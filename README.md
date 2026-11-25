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
- Image: `quay.io/redhat-et/patternfly:pricetag-ui` (public; no pull secret)
- Build and deployment details: `deploy/README.md`

The `redhat-et+enmaas` robot now has Write on `redhat-et/patternfly`, so the
Route pulls the published Quay image. Build and push with `deploy/build.sh`
and `podman push quay.io/redhat-et/patternfly:pricetag-ui`; deploy with
`UPSTREAM_TLS_NAME=localhost CA_FILE=... deploy/deploy.sh`.

## Test

```sh
npm run test:equiv          # local old UI + SPA; EQUIV_LOCAL_FIXTURE=1
npm run test:equiv:report   # HTML report + side-by-side screenshots
```

The equivalence suite runs the legacy gateway UI and this SPA side by side:
login, dashboard KPIs/range filter, manager org view, admin tabs, pricing,
view-as confirmation, and the keys surface. Local runs may use the seeded
`local-admin-key` only with `EQUIV_LOCAL_FIXTURE=1`; every other target must
supply `EQUIV_KEY`. Authenticated screenshots are local-only and tracing is
off, so a live run retains no page captures.

Live read-only run:

```sh
BASE_OLD=https://32.198.91.108:8443 \
BASE_NEW=https://pricetag-patternfly-pricetag-patternfly.apps.emerg.pcbk.p1.openshiftapps.com \
EQUIV_KEY="$(cat ~/.config/praxis-pricetag/32.198.91.108/admin.key)" \
npx playwright test
```

Destructive flows (key create/revoke, admin writes) stay on the local
standalone stack; never run them against the live gateway.

## Accessibility

PatternFly 6 supplies labelled form controls, table semantics, focus
management, and modal focus traps. The SPA adds page-level h1 headings,
aria-labels on every table and chart, keyboard-operable member/key rows, and
role=tabpanel labels for the admin tabs. `test/equiv/a11y.spec.cjs` runs
axe-core against login and the dashboard/manager/keys/admin surfaces; it is
part of `npm run test:equiv` and has no serious/critical violations locally
or on the live Route.
