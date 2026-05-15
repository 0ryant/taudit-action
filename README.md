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

## Golden path: required verify gate

Start with a single required `verify` job. It should run on pull requests with
`contents: read`, use an explicit policy path, and expose the wrapper outputs so
reviewers can confirm what the gate actually evaluated.

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
      - name: Checkout
        uses: actions/checkout@v4

      - name: Verify pipeline policy
        id: taudit
        uses: 0ryant/taudit-action@v1
        with:
          mode: verify
          version: 1.1.4
          policy: .taudit/policy/
          paths: .github/workflows/
          include-builtin: true

      - name: Self-audit taudit outputs
        if: always()
        run: |
          echo "outcome=${{ steps.taudit.outputs.outcome }}"
          echo "exit-code=${{ steps.taudit.outputs.exit-code }}"
          echo "policy=${{ steps.taudit.outputs.policy-path }}"
          echo "baseline-status=${{ steps.taudit.outputs.baseline-status }}"
          echo "new-findings=${{ steps.taudit.outputs.new-findings-count }}"
          echo "waived=${{ steps.taudit.outputs.waived-count }}"
          echo "taudit-version=${{ steps.taudit.outputs.taudit-version }}"
```

`verify` is the default mode, but setting it explicitly makes the merge gate
clear to reviewers. The default permission is `contents: read`; do not give the
scanner job write tokens, deployment credentials, cloud credentials, or secrets
unless you have a specific reviewed need.

What to verify after the first run:

- The required check name in branch protection matches `taudit / verify`.
- The step summary shows the expected `policy`, discovered suppressions or
  ignore file, baseline status, and gate mode.
- The outputs match the review intent: `outcome`, `exit-code`,
  `new-findings-count`, `waived-count`, and `taudit-version`.
- A non-zero exit is treated as authoritative for gate failure; outputs and the
  step summary explain what the wrapper saw, they do not override the job
  result.

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

Pin both layers:

- the GitHub Action ref in `uses:`
- the `taudit` CLI version in `with.version`

The Marketplace-friendly form below is readable, but `@v1` is a moving
compatibility ref:

```yaml
- uses: 0ryant/taudit-action@v1
  with:
    version: 1.1.4
    mode: verify
    policy: .taudit/policy/
    paths: .github/workflows/
```

For production change-control, replace `@v1` with the exact immutable release
tag or full commit SHA you approved. Keep `version` exact as well. Do not use a
floating `latest` for the `taudit` binary.

`fallback-cargo: true` is a recovery path, not the default pinning model. The
normal path downloads the exact GitHub release asset for `version` and verifies
its published SHA-256 checksum before extraction.

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

## Self-audit semantics

The action emits two operator-facing audit surfaces on every run:

- a GitHub step summary written by the wrapper
- GitHub Action outputs written to `GITHUB_OUTPUT`

The summary includes the requested mode, selected `taudit` version, policy
path, discovered ignore and suppression files, baseline root and status,
partial-graph policy, ADO enrichment status, gate mode, exit code, outcome, and
parsed counts where available.

These fields are useful for review and automation, but they are still local job
signals. They describe what the wrapper invoked and what machine-readable
results it could parse. They are not an independent hosted attestation that the
runner saw every file, that GitHub proved repository completeness, or that a
missing parsed count means zero findings.

Treat the trust boundary like this:

- The job exit code is the authoritative pass/fail signal.
- The step summary and outputs explain the wrapper context around that result.
- Uploaded JSON, SARIF, or graph artifacts are stronger evidence than log text
  when you need later audit or comparison.
- If you need stronger provenance than the GitHub job record itself, capture and
  retain artifacts from a trusted workflow or runner you control.

## Outputs

The action exposes machine-readable outputs from wrapper context and parsed
machine output where available:

| Output | Meaning |
| --- | --- |
| `exit-code` | Actual `taudit` process exit code. |
| `outcome` | `pass`, `violations`, or `config-error`. |
| `report-path` | File written by `output`, if any. |
| `graph-path` | Graph output path for `mode: graph`. |
| `findings-count` | Parsed finding count where available. Blank means no machine-readable count was recovered. |
| `policy-path` | Policy input used for `verify`. |
| `ignore-file-used` | Explicit or discovered ignore file, if known. |
| `suppressions-file-used` | Explicit or discovered suppressions file, if known. |
| `suppression-mode-used` | `downgrade` or `tag-only`. |
| `baseline-root-used` | Baseline root used for `scan` or `verify`. |
| `baseline-status` | Whether `.taudit/baselines/` was found under the selected root. |
| `partial-policy` | `normal` or `ignore-partial`. |
| `ado-enrichment` | Wrapper enrichment status. Today this is `unused` or `configured`; job failure is still the authoritative failure signal. |
| `new-findings-count` | New finding count where parsed from machine output. |
| `preexisting-critical-count` | Pre-existing critical count where parsed from machine output. |
| `waived-count` | Suppressed or baseline-waived count where parsed from machine output. |
| `taudit-version` | The version the wrapper selected for invocation and reports in the summary. |

Typical downstream uses:

- Fail-open diagnostics: print outputs in an `if: always()` step after the gate.
- Audit retention: pair `format: json` or `format: sarif` with `output` and
  upload the resulting file as an artifact.
- Rollout reporting: monitor `baseline-status`, `new-findings-count`, and
  `preexisting-critical-count` as teams move from baseline gating to
  `gate-on-all: true`.

## Exit codes

`taudit-action` preserves `taudit` exit semantics.

| Exit | Outcome | Meaning |
| --- | --- | --- |
| `0` | success | No policy violation, or advisory command completed. |
| `1` | failure by default | Findings or violations crossed the active gate. |
| `2` | failure | Configuration, usage, parse, missing policy, or cannot-decide error. |

`scan` is advisory/bootstrap in v1. Use `verify` for merge gates.

## Trust model

The action surface is typed. It does not expose `extra-args`, shell command
overrides, raw CLI passthrough, or arbitrary script inputs. Observed wrapper
behavior today is:

- inputs are normalized and validated before execution
- path-like inputs must stay workspace-relative
- `verify` requires `policy`
- ADO enrichment inputs are all-or-none
- the wrapper maps inputs to argv elements, not concatenated shell strings

That reduces accidental footguns, but it is not a proof system by itself. The
action runs inside the same GitHub job trust boundary as the rest of your
workflow. Keep untrusted pull-request runs read-only, separate SARIF upload from
the scanner job, and treat artifacts plus job history as the audit trail.

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
