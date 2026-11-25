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

- [x] Org scope toggle (person/team filter), time presets, summary line,
      org budget/saved/members cards, four chart blocks (hosted-vs-vendor,
      by model, by user, daily model usage), people table with sortable
      columns, and person drill-down (`/api/v1/org/*`).
- [x] Self scope: the live page falls back to the caller's own usage and the
      dashboard endpoints; the SPA keeps the same fallback and hides the
      members card/table.
- **Accept**: dual-run parity on local stack (seeded org tree). ✔ verified
  2026-11-25 against the local standalone stack as a super-admin: 8 people,
  $231/$4,800 org budget, 7 with usage; range presets, person filter
  (`root=` scoping), column sorting, person modal, and the four charts
  exercised in Playwright. Numeric dual-run parity follows in Phase 9.

## Phase 5 — My keys (`/management`)

- [x] Tabs (My keys / Create key); key table (search, status filter, page
      size, pagination, revoke); create-key flow with a reveal-once secret
      (Copy/Download only — the secret is never rendered or stored).
- [x] Key-expiry display with a live remaining-time countdown.
- **Accept**: create → list → revoke round-trip on local stack matches old
  UI behavior (allowance-races/key-controls tests as reference). ✔ verified
  2026-11-25: created `phase5-ui`, confirmed the reveal-once panel, listed it
  as active with expiry, revoked it through the PF confirmation dialog, and
  saw it as revoked under the All filter. The deployed `/me/keys` response
  omits `has_more`; the loader also accepts a short page as the end while
  keeping the live `has_more` contract.

## Phase 6 — Admin console (`/admin`)

- [x] Tab shell (Users, User keys, Safety Net, User quota, Model pricing,
      Discounts, Model Restrictions) + per-tab refresh + updated timestamp.
- [x] Users tab: create/update form, search/status filters, roles + manager
      assignment, key drill-down, view-as.
- [x] User keys tab: list, issue onboarding key with a reveal-once panel,
      revoke. The local maas stub returns 503
      (`group scope unavailable for key operations`) on admin revoke, so the
      revoke path was only code-verified here; mint returned 201.
- [x] Safety Net + User quota policy forms: safety-net limit/enforcement/
      bypass models save; quota overrides set/remove with the user picker
      and current-allowance note.
- [x] Model pricing save (managed rates or copy-from-source), explicit
      pricing refresh, and editable discount rules with version + save
      followed by a rate refresh. Model Restrictions stays read-only because
      the deployed page describes it as a read-only view of external
      policies.
- [x] Impersonation entry point (`/admin/impersonate?as=`).
- **Accept**: 6b verified on the local stack: safety-net save (limit 601,
  then restored 600), quota override set ($25) and removed, model-rate save
  + "Pricing refreshed", and discount policy save + refresh all succeeded in
  the admin UI. User create/update and role/manager PATCH were verified in
  6a; onboarding-key mint returned a reveal-once secret. Admin key revoke is
  code-verified. The local stack lacks the live platform-group + maas key
  store: a temporary local platform-group fallback reached maas, which
  returned 404 for the admin-minted key (stub limitation); the live gateway
  revokes correctly. Self-key revoke is covered in Phase 5. Read-only live
  parity follows in Phase 9.

## Phase 7 — Auxiliary states

- [x] `/welcome`, `/coming-soon`, `/blocked` (budget gate), the Pricing
      dialog, and a 404 page. Pricing is available from both the Usage and
      My team headers and reads `/api/v1/pricing` (with the
      “unused models too” toggle using `?used=0`).
- **Accept**: reachable where the old UI exposes them. The deployed host
  serves the EnMaaS `/welcome` landing and 404s `/coming-soon` and
  `/blocked`; the SPA provides branded PriceTag routes for all three, and
  the 404/blocked states are reachable directly. Verified the pricing
  dialog (live rate list) and `/welcome` in Playwright.

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
  The `redhat-et+enmaas` robot was granted **Write** on
  `redhat-et/patternfly`; the image is published as
  `quay.io/redhat-et/patternfly:pricetag-ui` (public) and the Deployment
  pulls it from Quay.

## Phase 9 — Equivalence suite + report

- [x] `test/equiv/surfaces.spec.cjs` dual-target Playwright suite
      (`BASE_OLD`, `BASE_NEW`): login, dashboard KPIs/filters, manager org
      view, admin read-only tabs, pricing dialog, view-as confirmation, and
      the keys surface; side-by-side screenshot attachments + HTML report.
- [x] Destructive flows run only against the local stack; the live run is
      read-only (login, navigation, non-submitted dialogs).
- **Accept**: suite green (local both bases; live read-only). ✔ local:
      16 passed, 2 skipped (both skips are axe on the legacy project; the old
      keys surface now follows the `/account?tab=keys` redirect and passes).
      Live read-only run against the gateway + Route with `EQUIV_KEY`: 16
      passed, 2 skipped, no screenshots/traces. Credential handling is opt-in
      for the seeded local key and produces no live artifacts.

## Phase 10 — Polish + docs

- [x] Accessibility pass: PF controls with FormGroup labels/ids, labelled
      tables, charts with ariaTitle/ariaDesc, modal labels/focus traps,
      keyboard-operable member/key rows, and admin tabpanel labels. Added
      automated axe coverage (`test/equiv/a11y.spec.cjs`) for login and the
      dashboard/manager/keys/admin surfaces; no serious/critical violations
      locally or live. Fixed the admin Tab `aria-controls` target and the
      light-theme contrast of client/provider/table accent text.
- [x] README (run, test, deploy, accessibility) and AGENTS.md project
      context updated with the live Route, Quay image, and equivalence
      suite.
- [x] ocr gate before every commit/push. Two commits (Phase 8, Phase 9)
      used the user-approved `OCR_GATE_BYPASS=1` after repeated
      false-positive/circular findings; all other commits passed the gate.

## Standing rules

- ocr review gate before every commit/push.
- Never modify existing projects/workloads on the emerg cluster — new
  namespace only (`pricetag-patternfly`), delete on request.
- AWS gateway stays read-only except the planned SG egress addition;
  destructive testing only against the local stack.
- MCP `playwright` server: add `--ignore-https-errors` to its command in
  `opencode.json` (project) so future sessions can drive the self-signed
  gateway directly.
