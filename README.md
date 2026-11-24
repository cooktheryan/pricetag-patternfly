# enmaas-patternfly

PatternFly 6 rebuild of the PriceTag metering UI with Red Hat branding.
Functional parity with the Go-served HTML UI in `redhat-et/pricetag-metering`
(`internal/dashboard/`), deployed on OpenShift.

- Spec: `specs/001-pricetag-patternfly/spec.md`
- Plan: `specs/001-pricetag-patternfly/plan.md`
- Old-UI reference captures: `docs/reference/` (screenshots + a11y snapshots)

## Quick start (once the app exists)

```sh
# local old stack (metering + postgres + maas stub) — from a pricetag-metering clone:
podman compose -f docker-compose.standalone.yaml up --build

# dev server (proxies /api + /login to the local stack):
npm run dev
```

## Environments

- Local stack: http://127.0.0.1:8080 (hermetic, safe for destructive tests)
- Live reference: https://32.198.91.108:8443 (read-only; credentials at
  `~/.config/praxis-pricetag/32.198.91.108/`, 0600)
- OpenShift: `pricetag-patternfly` namespace on
  `api.emerg.pcbk.p1.openshiftapps.com`
