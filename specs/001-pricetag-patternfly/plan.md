# Plan 001 — PriceTag UI rebuild in PatternFly

Working branch: `main` in `~/git/enmaas-patternfly`.
Reference assets: `docs/reference/` (old-UI screenshots and accessibility
snapshots captured 2026-11-24). Upstream live UI: https://32.198.91.108:8443.
Old-UI source: `~/git/pricetag-metering` @ `e4ba826`.

## Phase 0 — Bootstrap (done)

- [x] Create repo `~/git/enmaas-patternfly`, git init.
- [x] Enable MCP servers (project `opencode.json`): `context7` (remote,
      PatternFly docs), `playwright` (browser testing; needs
      `--ignore-https-errors` for the self-signed gateway — tracked below).
- [x] Live UI inventory + screenshots (admin session).
- [x] Route map from `cmd/main.go`; API surface list.
- [x] Spec written.

## Phase 1 — Scaffold the app (done)

- [x] `npm create vite@latest . -- --template react-ts`; add
      `@patternfly/react-core@^6.7`, `@patternfly/react-table`,
      `@patternfly/react-charts`, `@patternfly/react-icons`, `react-router`.
- [x] App shell: PF6 `Page` + `Masthead` (Red Hat logo lockup + "PriceTag"
      product name), `PageSidebar` navigation (Usage / My team / My keys /
      Admin), role-aware nav, sign-out, live clock. (Refresh buttons are
      per-page; they land with the pages in Phases 3–6.)
- [x] Vite dev proxy: `/api`, `/login`, `/logout`, `/admin/impersonate`,
      `/whoami`, `/me`, `/oauth` → `UPSTREAM` env (default
      `http://127.0.0.1:8080` local stack). Session-changing POSTs need the
      forwarded `Origin` rewritten to the gateway's `MANAGEMENT_PUBLIC_ORIGIN`
      (its same-origin CSRF check) — set via `UPSTREAM_PUBLIC_ORIGIN`.
- [x] Local old stack: `podman compose -f docker-compose.standalone.yaml
      up --build` in `~/git/pricetag-metering`, then
      `tools/local/bootstrap.sh` (shim `docker compose`→`podman compose`,
      `COMPOSE_PROJECT_NAME=pricetag-metering`) for the seeded super-admin.
- **Accept**: shell renders at localhost:5173 with PF branding; nav routes
  resolve; proxy reaches the local stack's `/health`. ✔ verified 2026-11-24.

## Phase 2 — Auth + login (done)

- [x] `/login` page: PF login layout, single masked API-key input
      (monospace, `sk-oai-...` placeholder — legacy login.html parity),
      error state on `?error=invalid`. Submit is a **native form POST** to
      `/login`; the browser follows the gateway's 302 to the role
      destination (/dashboard, /manager, /account — all SPA routes), which
      is exactly the legacy contract and avoids ambiguous outcome
      detection from `fetch`.
- [x] Session helper: `SessionProvider` reads `/whoami` (user, roles,
      display name); unauthenticated visits to shell routes redirect to
      `/login`; sign-out is the legacy two-step confirmation rendered as a
      PF modal (`GET /logout` dialog parity, `POST /logout` clears the
      session).
- [x] Role-aware nav: Usage (all), My team (`isSuperAdmin || isManager`,
      legacy dashboard.html rule), Admin (`isSuperAdmin`). Masthead shows
      display name + role suffix and a live clock.
- **Accept**: sign in as local-admin-key / local-test-user-key against the
  local stack lands on the role page; wrong key shows the error state and
  preserves the previous session. ✔ verified 2026-11-24 (alice/bob are
  live-gateway identities; the local stack's equivalents are the seeded
  bootstrap keys).

## Phase 3 — Usage dashboard (`/dashboard`)

- [x] Budget banner; filters (time presets, dates, model select, user
      multi-select, Clear All) hitting `/api/v1/dashboard/*`.
- [x] KPI cards (requests, tokens, cost, saved-with-comparison-select,
      active users).
- [x] Charts (PF `react-charts`): hosted-vs-vendor donut, By Model / By Tool /
      By User with metric toggles.
- [x] Recent Activity table (PF `react-table`), all 12 columns, live refresh.
      The live rows are informational — the deployed UI has no row
      drill-down (the 12-column table is the older layout).
- [x] Session-view dialog: in the live UI this is the "My view as user" /
      "Back to admin view" confirmation (`POST /admin/impersonate`), plus the
      impersonation banner — not a Recent Activity drill-down.
- **Accept**: values equal old UI for same filters (dual-run suite); filters
  and toggles functional. ✔ verified 2026-11-25 against the local standalone
  stack: KPI/chart/table values cross-checked against the API payloads and
  every filter, range preset, metric toggle, refresh (30s poll), and
  impersonation round-trip exercised in Playwright. Numeric dual-run parity
  lands with the Phase 9 suite.

## Phase 4 — Manager (`/manager`)

- [ ] Org scope toggle, time presets, summary line, org budget/saved/members
      cards, four chart blocks, people table + person drill-down
      (`/api/v1/org/*`).
- **Accept**: dual-run parity on local stack (seeded org tree).

## Phase 5 — My keys (`/management`)

- [ ] Tabs (My keys / Create key); key table (search, status filter, page
      size, pagination, revoke); create-key flow with reveal-once secret.
- [ ] Key-expiry display with remaining time.
- **Accept**: create → list → revoke round-trip on local stack matches old
  UI behavior (allowance-races/key-controls tests as reference).

## Phase 6 — Admin console (`/admin`)

- [ ] Tab shell (Users, User keys, Safety Net, User quota, Model pricing,
      Discounts, Model Restrictions) + per-tab refresh + updated timestamp.
- [ ] Users tab: create/update form, search/status filters, roles + manager
      assignment, key drill-down.
- [ ] User keys tab (mint/revoke/expire).
- [ ] Safety Net + User quota policy forms.
- [ ] Model pricing tables + refresh + discounts + restrictions.
- [ ] Impersonation entry point (`/admin/impersonate?as=`).
- **Accept**: all tabs render against local stack; user create/update and
  key mint/revoke round-trips pass; read-only parity on live gateway.

## Phase 7 — Auxiliary states

- [ ] `/welcome`, blocked (budget gate), coming-soon, Pricing dialog,
      404 page.
- **Accept**: reachable/equivalent where the old UI exposes them.

## Phase 8 — Container + OpenShift deployment

- [x] Multi-stage Containerfile: node build → nginx (SPA + proxy config,
      upstream via `UPSTREAM` env), non-root, pinned base digests.
- [x] nginx serves the SPA with a history fallback (all non-file GETs →
      index.html) and reverse-proxies the gateway paths (`/api`, `/whoami`,
      `/me`, `/oauth`, plus method-split `/login`, `/logout`,
      `/admin/impersonate`) so the native form POSTs and their 302
      destinations land on SPA routes. Verified through the Route: success
      POST → 302 `/dashboard`; invalid-key redirects for Phase 9.
- [x] Session-change CSRF: the proxy maps the browser's Route Origin to
      `UPSTREAM_PUBLIC_ORIGIN` for the three session POSTs, preserves
      `Sec-Fetch-Site`, and relies on the gateway's Origin check plus the
      HttpOnly SameSite=Lax cookie. No gateway configuration change.
- [x] Manifests: Namespace `pricetag-patternfly`, Deployment, Service,
      Route (edge TLS), gateway CA ConfigMap.
- [x] Cluster egress: egress pod in the namespace showed the two NAT EIPs
      (`100.49.194.73` us-east-1a, `32.196.43.142` us-east-1b); both `/32`
      ingress rules added to `sg-0641342b373ff74e7` for TCP 8443 (user
      approved), verified from the pod.
- [x] Deploy, verify sign-in through the Route against the live gateway.
- **Accept**: new UI served over the cluster Route with live data. ✔
  Deployed 2026-11-25 at
  `https://pricetag-patternfly-pricetag-patternfly.apps.emerg.pcbk.p1.openshiftapps.com`:
  `POST /login` → 302 `/dashboard`, `/whoami` with the session returns the
  live administrator, and the browser loads the SPA with no console errors.
  The rollout currently pulls from the cluster's internal registry; the
  intended image `quay.io/redhat-et/patternfly:pricetag-ui` builds and is
  ready, pending **Write** for the `redhat-et+enmaas` robot on the public
  `redhat-et/patternfly` repository.

## Phase 9 — Equivalence suite + report

- [ ] `test/equiv/*.spec.cjs` dual-target Playwright suite (`BASE_OLD`,
      `BASE_NEW`): login, dashboard values/filters, manager, keys, admin
      read-only, session dialog; side-by-side screenshot report.
- [ ] Destructive flows run only against the local stack; live gateway
      read-only.
- **Accept**: suite green (local both bases; live read-only).

## Phase 10 — Polish + docs

- [ ] Accessibility pass (PF a11y, keyboard nav, labels).
- [ ] README (run, test, deploy); AGENTS.md project context.
- [ ] ocr gate before every commit/push.

## Standing rules

- ocr review gate before every commit/push.
- Never modify existing projects/workloads on the emerg cluster — new
  namespace only (`pricetag-patternfly`), delete on request.
- AWS gateway stays read-only except the planned SG egress addition;
  destructive testing only against the local stack.
- MCP `playwright` server: add `--ignore-https-errors` to its command in
  `opencode.json` (project) so future sessions can drive the self-signed
  gateway directly.
