# REVIEW.md

Repository-specific review standards for Qodo code review. Keep findings actionable and
reproducible from the diff; formatting and lint-level nits are handled by `oxlint` and
`tsc`.

## Out of scope

- Build and test output: `dist/`, `test-results/`, `.playwright-mcp/`, `node_modules/`.
- Dependency bumps (Dependabot) unless the bump changes runtime behavior.
- Pure formatting or naming style already enforced by the linters.
- `specs/**` prose, unless the implementation contradicts the spec.

## Security invariants (flag any regression)

- **Keys never leave refs.** Minted API keys and session credentials must not enter React
  state, the DOM, `localStorage`/`sessionStorage`, URLs, analytics, or logs. Reveal state
  must auto-clear.
- **Edge headers stay strict.** `deploy/k8s/nginx-config.yaml` must keep CSP, HSTS,
  frame-ancestors, Referrer-Policy, Permissions-Policy, and COOP/CORP; it must clear
  inbound identity headers (`X-Forwarded-User`, `X-User`, `Forwarded`) and normalize XFF.
- **Container posture.** Runtime stays non-root (UID 1001), read-only root filesystem,
  `drop: ALL`, no service-account token, and digest-pinned images.
- **No credential literals** in manifests, scripts, fixtures, or tests. Local test keys are
  placeholders only and must never match a real credential.

## Backend contracts

- **Both metering shapes are valid.** Standalone metering returns a bare array for
  `/api/v1/org/usage`; cluster mode returns `{rows, totals}`. Parsers must accept both, and
  the same rule applies to any endpoint with a mode-dependent envelope.
- **Trust boundaries.** `X-Forwarded-User` and the API-key login flow are edges: validate
  there, never trust client-supplied identity downstream.
- **URL space is a contract.** Routes mirror the legacy gateway URLs; renaming or moving a
  route needs a redirect or a stated reason.

## Deploy scripts (`deploy/**/*.sh`)

- Must be idempotent and safe to re-run.
- Flag unquoted expansions, unchecked commands, and mutations that happen before inputs
  are validated.
- Manifest changes must keep probes, resource limits, and NetworkPolicy scope; widening
  ingress/egress needs a stated reason in the PR.

## Testing

- Behavior changes need a unit test or an equivalence-suite update (`test/equiv/`).
- UI-only visual changes may rely on Playwright coverage.
- Prefer findings backed by a concrete failure scenario over speculative refactors.
