# taudit-action smoke

Minimal consumer fixture used to smoke-test `0ryant/taudit-action` release tags.

Absorbed into the `taudit-action` repo 2026-05-21 from the standalone
`0ryant/taudit-action-smoke` repository (per ecosystem-catalog
portfolio-audit-round-2 §3 taudit-action-smoke, operator-confirmed
2026-05-21).

The driving workflow lives at `.github/workflows/smoke-test.yml` at the
repo root (path-filtered to `smoke-test/**`). The `target.yml` here is the
intentionally trivial workload that the action audits.
