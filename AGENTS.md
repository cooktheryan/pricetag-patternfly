# Project context — enmaas-patternfly

## Active feature

Spec: `specs/001-pricetag-patternfly/spec.md`
Plan: `specs/001-pricetag-patternfly/plan.md`

## Stack

- Vite 8 + React 19 + TypeScript
- PatternFly 6 (`@patternfly/react-core@^6.7`, `react-table`, `react-charts`,
  `react-icons`) — Red Hat branding, default light theme
- react-router mirroring the legacy URL space
- Deploy: nginx container (SPA + same-origin reverse proxy), OpenShift Route

## Status

Phases 1–9 are implemented; Phase 10 is the docs/a11y close-out. The SPA is
live at
https://pricetag-patternfly-pricetag-patternfly.apps.emerg.pcbk.p1.openshiftapps.com
(namespace `pricetag-patternfly`), pulling
`quay.io/redhat-et/patternfly:pricetag-ui` from the public Quay repo.

- Equivalence suite: `npm run test:equiv` (local old gateway + SPA).
- Local stack: `~/git/pricetag-metering` standalone compose, seeded with
  `local-admin-key`.
- Deployment: `deploy/README.md`; `deploy/deploy.sh` derives the Route
  origin and refreshes the gateway CA ConfigMap.

## Reference surfaces

- Old UI source: `~/git/pricetag-metering` @ `e4ba826` (`internal/dashboard/`)
- Live old UI: https://32.198.91.108:8443 (self-signed; credentials under
  `~/.config/praxis-pricetag/32.198.91.108/`, 0600, admin/alice/bob)
- Old-UI captures: `docs/reference/`
- Behavioral spec: `~/git/pricetag-metering/tests/ui/*.cjs`

## Rules

- ocr gate before every commit/push.
- Emerg cluster: new namespace `pricetag-patternfly` only; never touch
  existing projects/workloads.
- Live AWS gateway is read-only; destructive flows run against the local
  standalone stack only.
- Use the `context7` MCP for current PatternFly docs; `playwright` MCP
  (or playwright-cli with the ignore-https-errors config at
  `/private/var/folders/rf/64nc6mpn2vj0j9twbwhly0gm0000gn/T/opencode/pf-ui/cli.config.json`)
  for browser work against the self-signed gateway.
