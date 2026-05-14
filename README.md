# taudit GitHub Action

Lock down pipeline authority paths before they reach `main`.

`taudit-action` wraps the `taudit` CLI for GitHub Actions. Use it as a required
PR check to verify that workflow changes still satisfy your team's pipeline
authority policy. It evaluates CI/CD authority paths, policy invariants,
suppressions, and baselines using the `taudit` CLI contract.

The full source-of-truth contract for the Marketplace action lives in the
`taudit` repository:
[`docs/integrations/github-marketplace-action-contract.md`](https://github.com/0ryant/taudit/blob/main/docs/integrations/github-marketplace-action-contract.md).
This README is the operator-facing guide for that contract.

## Quickstart: required verify gate

Add this workflow and mark the `taudit / verify` job as a required status check
in branch protection.

```yaml
name: taudit

on:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Verify pipeline policy
        uses: 0ryant/taudit-action@v1
        with:
          mode: verify
          policy: .taudit/policy/
          paths: .github/workflows/
          include-builtin: true
```

`verify` is the default mode, but setting it explicitly makes the merge gate
clear to reviewers. The default permission is `contents: read`; do not give the
scanner job write tokens, deployment credentials, cloud credentials, or secrets
unless you have a specific reviewed need.

## Configuration model

`taudit` has separate controls. Keep them separate in review:

| Control | Purpose | Action input |
| --- | --- | --- |
| Policy | Positive invariants: what must be true. Required for `verify`. | `policy` |
| `.tauditignore` | Coarse path/rule mute for known noise classes. | `ignore-file` or auto-discovery |
| Suppressions | Per-finding reviewed waiver with reason, approver, and expiry rules. | `suppressions`, `suppression-mode` |
| Baselines | Adoption snapshot that gates on new findings while retaining critical-waiver rules. | `baseline-root`, `gate-on-all` |

Policy is not a general config directory. It is the invariant bundle the gate
enforces. Built-in rules are off in `verify` unless `include-builtin: true` is
set.

Use `.tauditignore` sparingly for broad, intentional exclusions. Use
suppressions when a specific finding has been reviewed and accepted. Use
baselines to adopt taudit on existing repositories without making historical
non-critical findings block the first PR.

## Bootstrap an existing repository

Run the first pass locally or in an advisory workflow:

```bash
taudit scan .github/workflows/
```

Create a policy directory:

```bash
mkdir -p .taudit/policy
taudit invariants list --invariants-dir .taudit/policy/
```

For brownfield repositories, capture a baseline before making the PR gate
required:

```bash
taudit baseline init .github/workflows/
git add .taudit/baselines/
```

Then enable the action in `verify` mode:

```yaml
- name: Verify with rollout baseline
  uses: 0ryant/taudit-action@v1
  with:
    mode: verify
    policy: .taudit/policy/
    paths: .github/workflows/
    include-builtin: true
    baseline-root: .
```

With a baseline present, `verify` gates new findings and unwaived critical
pre-existing findings. Set `gate-on-all: true` when you are ready to block on
the full current finding set.

## Reviewed suppressions

Suppression files are discovered from `.taudit-suppressions.yml` and
`.taudit/suppressions.yml`, or supplied explicitly:

```yaml
- name: Verify with reviewed suppressions
  uses: 0ryant/taudit-action@v1
  with:
    mode: verify
    policy: .taudit/policy/
    paths: .github/workflows/
    suppressions: .taudit-suppressions.yml
    suppression-mode: downgrade
```

Create entries with the CLI so fingerprints and required fields are explicit:

```bash
taudit suppressions add \
  --fingerprint 5edb30f4db3b5fa3d7fe7289374b7155 \
  --rule-id untrusted_with_authority \
  --reason "Internal action reviewed by platform security." \
  --accepted-by platform@example.com \
  --expires-at 2026-08-11
```

`downgrade` lowers severity by one tier and can affect severity-threshold
gating. `tag-only` preserves severity and adds metadata; in `verify`, it does
not make a finding pass by itself. Critical suppressions must expire.

## Graph outputs

Use graph mode to export the modeled authority graph as a workflow artifact.

```yaml
- name: Export authority graph
  uses: 0ryant/taudit-action@v1
  with:
    mode: graph
    paths: .github/workflows/
    graph-view: authority
    format: mermaid
    output: taudit-authority-graph.mmd

- name: Upload authority graph
  uses: actions/upload-artifact@v4
  with:
    name: taudit-authority-graph
    path: taudit-authority-graph.mmd
```

Use `graph-view: exploit` when you want the exploit-candidate projection
instead of the authority projection.

## SARIF generation and upload

SARIF upload is intentionally a separate step. The scanner job only needs
`contents: read`; uploading to GitHub Code Scanning requires
`security-events: write`.

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  sarif:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate taudit SARIF
        uses: 0ryant/taudit-action@v1
        continue-on-error: true
        with:
          mode: verify
          policy: .taudit/policy/
          paths: .github/workflows/
          format: sarif
          output: taudit.sarif

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: taudit.sarif
```

For untrusted pull requests, keep the SARIF upload out of the same job that
executes PR-controlled scanner inputs. A common conservative pattern is to run
the required `verify` gate on pull requests with `contents: read`, then upload
SARIF from trusted branch or scheduled workflows.

## Pinning

Pin both the action and the CLI version used by the action.

```yaml
- uses: 0ryant/taudit-action@v1
  with:
    version: 1.1.4
    mode: verify
    policy: .taudit/policy/
    paths: .github/workflows/
```

Use immutable release tags or commit SHAs for production change-control. The
`v1` tag is a compatibility tag and can move to newer compatible v1 releases.
Do not use floating `latest` for the `taudit` binary.

## Inputs

Common inputs:

| Input | Default | Notes |
| --- | --- | --- |
| `mode` | `verify` | `verify`, `scan`, or `graph`. |
| `version` | Action release default | Exact `taudit` CLI version. No floating `latest`. |
| `paths` | `.github/workflows/` | Newline-separated paths or globs. |
| `platform` | `auto` | `auto`, `github-actions`, `azure-devops`, `gitlab`, or `bitbucket`. |
| `policy` | none | Required for `verify`. File or directory of invariants. |
| `include-builtin` | `false` | Adds taudit built-in rules to `verify`. |
| `ignore-file` | auto-discover | Explicit `.tauditignore` path. Must exist if set. |
| `suppressions` | auto-discover | Explicit suppressions path. Must exist if set. |
| `suppression-mode` | `downgrade` | `downgrade` or `tag-only`. |
| `baseline-root` | workspace | Root containing `.taudit/baselines/`. |
| `gate-on-all` | `false` | Ignore baseline-new-only behavior. |
| `strict` | `false` | Treat discovered-file read/parse errors as config errors. |
| `ignore-partial` | `false` | Explicitly suppress partial-derived findings. |
| `format` | mode default | `verify`: `text`, `json`, `sarif`; `scan`: `terminal`, `json`, `sarif`, `cloudevents`; `graph`: `json`, `dot`, `mermaid`, `summary`. |
| `output` | none | Workspace-relative output file. |
| `graph-view` | `authority` | `authority` or `exploit`. |
| `severity-threshold` | CLI default | `critical`, `high`, `medium`, `low`, or `info`. |
| `max-hops` | CLI default | Positive integer BFS cap. |
| `no-color` | `true` in CI | Stable logs. |
| `fallback-cargo` | `false` | Controlled fallback to locked `cargo install` if release asset resolution fails. |

Azure DevOps enrichment inputs are optional and all-or-none: `ado-org`,
`ado-project`, and `ado-pat`. The PAT should have read-only variable group
scope and must be passed as a GitHub secret.

## Outputs

The action exposes machine-readable outputs from the wrapper summary where
available:

| Output | Meaning |
| --- | --- |
| `exit-code` | Actual `taudit` process exit code. |
| `outcome` | `pass`, `violations`, or `config-error`. |
| `report-path` | File written by `output`, if any. |
| `graph-path` | Graph output path for `mode: graph`. |
| `findings-count` | Parsed finding count where available. |
| `policy-path` | Policy input used for `verify`. |
| `ignore-file-used` | Explicit or discovered ignore file, if known. |
| `suppressions-file-used` | Explicit or discovered suppressions file, if known. |
| `suppression-mode-used` | `downgrade` or `tag-only`. |
| `baseline-root-used` | Baseline root used for `scan` or `verify`. |
| `baseline-status` | `found`, `missing`, `unused`, or `unknown`. |
| `partial-policy` | `normal` or `ignore-partial`. |
| `ado-enrichment` | `unused`, `configured`, or `failed`. |
| `new-findings-count` | New finding count where parsed. |
| `preexisting-critical-count` | Pre-existing critical count where parsed. |
| `waived-count` | Suppressed or baseline-waived count where parsed. |
| `taudit-version` | Actual binary version invoked. |

## Exit codes

`taudit-action` preserves `taudit` exit semantics.

| Exit | Outcome | Meaning |
| --- | --- | --- |
| `0` | success | No policy violation, or advisory command completed. |
| `1` | failure by default | Findings or violations crossed the active gate. |
| `2` | failure | Configuration, usage, parse, missing policy, or cannot-decide error. |

`scan` is advisory/bootstrap in v1. Use `verify` for merge gates.

## Security model

The v1 action surface is typed. It does not expose `extra-args`, shell command
overrides, raw CLI passthrough, or arbitrary script inputs. Inputs are intended
to map to argv elements, not concatenated shell strings.

Recommended defaults:

- Use `permissions: contents: read` for PR verification.
- Keep SARIF upload in a separate explicit step that has
  `security-events: write`.
- Do not pass secrets to scanner jobs that run on untrusted pull requests.
- Pin action and CLI versions for production workflows.
- Keep policies, suppressions, ignore files, and baselines under normal code
  review.
- Treat partial or unknown graph coverage as a signal to investigate, not as a
  hidden pass.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `verify` exits `2` | Confirm `policy` exists, is readable, and is non-empty unless `include-builtin: true` is set. |
| Built-in findings are missing | Set `include-builtin: true`; built-ins are off by default in `verify`. |
| A reviewed finding still blocks | If `suppression-mode: tag-only`, the finding is only tagged. Use `downgrade`, a baseline waiver, or another explicit gate control if appropriate. |
| A baseline is not applied | Editing a pipeline changes the content hash. Re-run `taudit baseline init <paths>` or review with `taudit baseline diff`. |
| SARIF upload fails with permissions | Add `security-events: write` to the SARIF upload workflow/job, not to the default PR scanner job. |
| Directory scans skip malformed files | Use `strict: true` to make discovered-file read/parse errors exit `2`. |
| ADO enrichment is partial | Check that `ado-org`, `ado-project`, and `ado-pat` are all set and that the PAT has read-only variable group access. |

## More examples

See:

- [`examples/verify-gate.yml`](examples/verify-gate.yml)
- [`examples/baseline-rollout.yml`](examples/baseline-rollout.yml)
- [`examples/sarif-upload.yml`](examples/sarif-upload.yml)
- [`examples/graph-export.yml`](examples/graph-export.yml)
- [`docs/workflow-examples.md`](docs/workflow-examples.md)
