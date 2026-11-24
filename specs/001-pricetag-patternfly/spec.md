# Spec 001 — PriceTag UI rebuild in PatternFly with Red Hat branding

## Objective

Rebuild the PriceTag metering web UI — currently ~12,400 lines of server-rendered
HTML/JS served by the `pricetag-metering` Go service — as a standalone
**PatternFly 6 React** single-page application with Red Hat branding, functionally
matching the existing UI, deployed to OpenShift, with automated old-vs-new
equivalence testing driven by Playwright.

## Background — the current UI

- **Source**: `redhat-et/pricetag-metering` @ `e4ba826` ("standalone management
  mode"), templates in `internal/dashboard/*.html`, routes in `cmd/main.go`.
  Local clone: `~/git/pricetag-metering` (has the exact deployed revision).
- **Live reference**: https://32.198.91.108:8443 — the enmaas-mini single-server
  deployment (praxis-ai gateway on 8443 → metering service). Credentials for
  admin/alice/bob are at `~/.config/praxis-pricetag/32.198.91.108/` (0600).
  The gateway is IP-restricted to the workstation.
- **Auth**: `POST /login` with `api_key` → session cookie. OIDC hooks exist in
  the backend but are disabled on this deployment (login page renders an SSO
  button only when configured).
- **Roles**: super admin, manager, user. Navigation and landing page adapt to
  role (`internal/handler/auth.go`: admin → `/dashboard`, manager → `/manager`,
  user → `/account` — `/account` is a 404 in standalone mode, so user-role
  behavior is out of scope for parity).
- **Behavioral reference tests** (the old UI's de facto functional spec):
  `pricetag-metering/tests/ui/{table-browser,session-dialog-browser,allowance-races-browser,key-controls,table-controls,local-review}.cjs`
  and enmaas-mini's `tests/pricetag/browser/` suite + `management-users.test.cjs`.

## Live-verified page inventory (2026-11-24, admin session)

### 1. `/login` — Sign In (login.html, 57 lines)
- Title "PriceTag — Sign In"; dark card, API-key password field
  (`sk-oai-…` placeholder), error banner on `?error=invalid`, OIDC button hook,
  dev-only persona quick-login grid.

### 2. `/dashboard` — Usage (dashboard.html, 2,275 lines)
- Top nav: PriceTag brand → Usage / My team / My keys / Admin; right side:
  live clock, Refresh, "My view as user" (impersonate), Pricing dialog,
  role label, Sign out.
- Monthly-budget banner (admin exempt message).
- Filters: time presets 24h/7d/30d/MTD, from/to date inputs, model select,
  user multi-select, Clear All.
- KPI cards: Total Requests, Total Tokens, Estimated Cost, Saved · Hosted
  Models (with comparison-model select), Active Users.
- Charts: Token Usage · Hosted vs Vendor (donut), By Model (Cost/Tokens/
  Requests toggle), By Tool (Tokens/Requests/Users), By User Top 5
  (Cost/Tokens/Requests).
- Recent Activity (live) table: Time, User, Client, Model, Provider, Status,
  Input, Output, Cached, Cache Write, Total, Cost. Row click → session dialog.

### 3. `/manager` — My team (manager.html, 1,678 lines)
- Org view: "Whole organisation" scope toggle, time presets.
- Summary: "N people in your tree · N with a gateway key …".
- Cards: Org budget (with monthly cap), Saved · Hosted Models (comparison
  select), Members (with active count).
- Charts: Token Usage · Hosted vs Vendor, By Model, By User (Cost/Tokens/
  Requests toggles), Daily model usage (Tokens/Dollars).
- People table (tree/scope-aware) → person drill-down.

### 4. `/management` — My keys (management-admin-keys.html + controls, session tab shell)
- Tabs: My keys / Create key.
- Key table: Name / key ID, Status (active/revoked/expired), Expires (with
  remaining time), Revoke action; search box, status filter, page-size select,
  pagination ("Page 1 of 1 · N results").
- Create key flow: name, expiry; created-key reveal with copy.
- Note: revoked/expired keys remain for audit.

### 5. `/admin` — Admin Console (admin.html, 4,796 lines — largest page)
- Tabs: **Users, User keys, Safety Net, User quota, Model pricing, Discounts,
  Model Restrictions** + per-tab Refresh and "updated HH:MM:SS".
- Users tab: create/update user form (Login, Name, State active/inactive),
  user table with search (login, name, email, user ID), status filter, roles
  and manager assignment, key details drill-down.
- User keys tab: per-user key administration (mint/revoke/expire).
- Safety Net / User quota: budget and allowance policy editing.
- Model pricing: per-model price tables, refresh, historical repricing,
  discounts, model restrictions (allowed/denied per user/role).
- Impersonation: `/admin/impersonate?as=<user>` (view as user).

### 6. Auxiliary
- `/welcome` (onboarding), `blocked.html` (budget-gate block),
  session-view-dialog.html + session-confirm.html (drill-down dialogs),
  `coming-soon.html`.
- `/logout`, `/health`, `/ready`.

### API surface consumed by the UI
- `/api/v1/dashboard/*`: overview, groups, users, directory-users, models,
  tools, geo, cost-centers, timeline, recent (cached via `dashCache`).
- `/api/v1/me/*`: usage summary/models/recent, keys.
- `/api/v1/org/*`: scope, usage, charts, person.
- `/api/v1/management/*`: keys, key-revocations, general management API.
- `/api/v1/admin/*`: providers, models, weights, config, pricing refresh,
  safety-net, pricing-discounts, pricing/reprice (+ status), model-policies,
  dashboard-policies (+ per-country), keys, cache-stats, rollups.
- `/api/v1/pricing` (list).

## Goals

1. **PatternFly 6** React SPA (`@patternfly/react-core` 6.7.x, `react-table`,
   `react-charts`, `react-icons`) with **Red Hat branding** — PatternFly's
   default Red Hat visual language, RH logo lockup in the masthead, "PriceTag"
   product identity.
2. **Functional parity** on the five core surfaces: login, dashboard, manager,
   management (keys), admin console — plus the session dialog and auxiliary
   states (welcome, blocked).
3. **Same-origin deployment**: a reverse-proxy container serves the SPA and
   forwards `/api`, `/login`, `/logout`, `/admin/impersonate` to the upstream
   gateway, so the session cookie and all API calls work with **zero backend
   changes**.
4. **Old-vs-new equivalence testing** with Playwright: one parameterized suite
   (`BASE_OLD` / `BASE_NEW`) asserting matching behavior and data.
5. **OpenShift deployment** in a new namespace on
   `api.emerg.pcbk.p1.openshiftapps.com` (ROSA 4.21).

## Non-goals

- No changes to `pricetag-metering` (backend) or `enmaas-mini`.
- OIDC login flow UI (backend hook placeholder only — disabled upstream).
- m2m/partner API surfaces (no UI today).
- `/routing` (`/admin2`) legacy page.
- `/account` user self-service page (404 in standalone mode today).
- Dark-mode parity beyond what PatternFly provides natively.

## Architecture

```
┌───────────────────────── OpenShift (new namespace) ─────────────────────────┐
│  Route (edge TLS) → Service → Deployment                                    │
│    Container: nginx                                                          │
│      /            → static PatternFly SPA (Vite build)                       │
│      /api/* /login /logout /oauth/* /admin/impersonate                       │
│                   → proxy → https://32.198.91.108:8443 (praxis gateway)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Stack**: Vite 8 + React 19 + TypeScript; `@patternfly/react-core@6.7`,
  `react-table`, `react-charts`, `react-icons`; `react-router` mirroring the
  legacy URL space (`/login`, `/dashboard`, `/manager`, `/management`, `/admin`).
- **Dev**: `vite` dev-server proxy to a **local standalone metering stack**
  (`podman compose -f docker-compose.standalone.yaml up --build` in the
  pricetag-metering clone — metering + PostgreSQL + MaaS stub on 127.0.0.1,
  seeded via `seeds/user_profiles.json`) or to the live AWS gateway.
- **Testing**:
  - **Hermetic**: local standalone stack for destructive flows (key
    create/revoke, user edits, pricing changes).
  - **Live read-only**: the AWS gateway for data-fidelity assertions.
  - **Playwright dual-run**: `BASE_OLD=<url> BASE_NEW=<url> node test/equiv/*.spec.cjs`
    producing a side-by-side report (screenshots + extracted values).
- **Upstream reachability from the cluster**: the AWS security group currently
  restricts 8443 to the workstation IP. Determine the cluster egress IP (tiny
  echo pod in the new namespace) and add it to the SG. The gateway keeps
  TLS + API-key auth.

## Functional requirements

Per-page requirements follow the inventory above. Every control, filter,
toggle, table column, dialog, and error state listed there must exist in the
new UI with equivalent behavior against the same upstream APIs. Where
PatternFly provides a superior native interaction (e.g. accessible dropdowns,
pagination), the PatternFly component is preferred over pixel-copying the old
custom control.

## Acceptance criteria

1. An admin can sign in on the new UI with an API key and reach all five pages
   with role-appropriate navigation.
2. Dashboard KPIs, charts, filters, and Recent Activity rows match the old UI
   for the same time window and filters (Playwright-extracted values equal).
3. Manager org cards/charts/tables match the old UI for the same window.
4. Keys list matches; create + revoke round-trip works against the local stack.
5. Admin console: all seven tabs render with equivalent tables/forms; user
   create/update works against the local stack; read-only parity on live.
6. Session dialog opens from Recent Activity rows with equivalent content.
7. New UI deployed on the emerg cluster and reachable over its Route.
8. Equivalence suite green against the local stack (both bases) and read-only
   green against the live gateway.
9. Red Hat/PatternFly branding: PF6 default theme, RH logo lockup in the
   masthead, no legacy hand-rolled CSS.

## Risks / open questions

- **Cluster egress to the AWS gateway** — needs the SG widening; if the user
  prefers not to, the OpenShift deployment can target the local/other upstream.
- **Session cookie forwarding** through the proxy (path/flags) — validated in
  the deployment phase.
- **Admin console size** (4.8k lines of legacy template) — largest single
  deliverable; phased tab-by-tab.
- **Chart data shapes** — old UI uses custom SVG; PF charts consume the same
  JSON but mapping is manual.
