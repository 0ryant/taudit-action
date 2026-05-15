# Workflow examples

These examples follow the current action surface and keep `verify` as the
operator-facing golden path. Start there, then add baselines, suppressions,
SARIF, or graph export as needed.

## Golden path: required verify gate

```yaml
name: taudit

on:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    name: taudit / verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: taudit
        uses: 0ryant/taudit-action@v1
        with:
          mode: verify
          version: 1.1.4
          policy: .taudit/policy/
          paths: .github/workflows/
          include-builtin: true
          strict: true
      - if: always()
        run: |
          echo "outcome=${{ steps.taudit.outputs.outcome }}"
          echo "exit=${{ steps.taudit.outputs.exit-code }}"
          echo "policy=${{ steps.taudit.outputs.policy-path }}"
          echo "baseline=${{ steps.taudit.outputs.baseline-status }}"
          echo "new=${{ steps.taudit.outputs.new-findings-count }}"
          echo "waived=${{ steps.taudit.outputs.waived-count }}"
```

Use `@v1` for discovery and examples. For production change-control, replace it
with the exact immutable release tag or full commit SHA you approved and keep
`version` pinned as well.

## Verify gate with JSON evidence artifact

```yaml
name: taudit audit evidence

on:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    name: taudit / verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: taudit
        uses: 0ryant/taudit-action@v1
        with:
          mode: verify
          version: 1.1.4
          policy: .taudit/policy/
          paths: .github/workflows/
          include-builtin: true
          format: json
          output: taudit-report.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: taudit-report
          path: taudit-report.json
```

## Existing repository: baseline-first rollout

Capture the baseline locally before enabling the required check:

```bash
taudit scan .github/workflows/
taudit baseline init .github/workflows/
git add .taudit/baselines/
```

Then add the gate:

```yaml
name: taudit

on:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: 0ryant/taudit-action@v1
        with:
          mode: verify
          version: 1.1.4
          policy: .taudit/policy/
          paths: .github/workflows/
          include-builtin: true
          baseline-root: .
```

## Reviewed exception

Create the waiver with the CLI, commit the suppressions file, and keep it under
review:

```bash
taudit suppressions add \
  --fingerprint 5edb30f4db3b5fa3d7fe7289374b7155 \
  --rule-id untrusted_with_authority \
  --reason "Internal action reviewed by platform security." \
  --accepted-by platform@example.com \
  --expires-at 2026-08-11
git add .taudit-suppressions.yml
```

Use `downgrade` when the waiver should affect severity-threshold gating:

```yaml
- uses: 0ryant/taudit-action@v1
  with:
    mode: verify
    version: 1.1.4
    policy: .taudit/policy/
    paths: .github/workflows/
    suppressions: .taudit-suppressions.yml
    suppression-mode: downgrade
```

Use `tag-only` when downstream systems should see the waiver metadata but the
finding should still count at its original severity in `verify`.

## Gate all findings after rollout

When the baseline has served its adoption purpose, flip the gate from
"new findings plus unwaived critical pre-existing" to the full current set:

```yaml
- uses: 0ryant/taudit-action@v1
  with:
    mode: verify
    version: 1.1.4
    policy: .taudit/policy/
    paths: .github/workflows/
    include-builtin: true
    baseline-root: .
    gate-on-all: true
```

## Coarse ignore

`.tauditignore` is a broad escape hatch. Prefer policy changes, baselines, or
per-finding suppressions when possible.

```yaml
- uses: 0ryant/taudit-action@v1
  with:
    mode: verify
    version: 1.1.4
    policy: .taudit/policy/
    paths: .github/workflows/
    ignore-file: .tauditignore
```

## SARIF upload

Use a separate upload step with `security-events: write`.

```yaml
name: taudit sarif

on:
  push:
    branches:
      - main

permissions:
  contents: read
  security-events: write

jobs:
  sarif:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: 0ryant/taudit-action@v1
        continue-on-error: true
        with:
          mode: verify
          version: 1.1.4
          policy: .taudit/policy/
          paths: .github/workflows/
          format: sarif
          output: taudit.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: taudit.sarif
```

## Graph artifact

Graph mode is observational. Use it to inspect modeled authority paths, not as
a substitute for the required `verify` gate.

```yaml
name: taudit graph

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  graph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: 0ryant/taudit-action@v1
        with:
          mode: graph
          version: 1.1.4
          paths: .github/workflows/
          graph-view: authority
          format: mermaid
          output: taudit-authority-graph.mmd
      - uses: actions/upload-artifact@v4
        with:
          name: taudit-authority-graph
          path: taudit-authority-graph.mmd
```
