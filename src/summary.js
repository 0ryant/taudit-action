import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function maskSecrets(text, secrets = []) {
  let redacted = String(text ?? '');
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(String(secret)).join('***');
  }
  return redacted;
}

export const redactSecrets = maskSecrets;
export const sanitizeSummary = maskSecrets;

export function createSummary(result = {}, context = {}) {
  const secrets = context.secrets ?? [];
  const summary = [
    `taudit mode: ${context.mode ?? 'unknown'}`,
    `taudit version: ${context.tauditVersion ?? 'unknown'}`,
    `policy: ${context.policyPath ?? 'not used'}`,
    `include built-ins: ${Boolean(context.includeBuiltin)}`,
    `ignore file: ${context.ignoreFile ?? 'not found'}`,
    `suppressions: ${context.suppressions ?? 'not found'} (mode=${context.suppressionMode ?? 'downgrade'})`,
    `baseline root: ${context.baselineRoot ?? 'not used'} (${context.baselineStatus ?? 'unknown'})`,
    `partial graph policy: ${context.partialPolicy ?? 'normal'}`,
    `ADO enrichment: ${context.adoEnrichment ?? 'unused'}`,
    `gate: ${context.gate ?? defaultGate(context)}`,
    `exit: ${context.exitCode ?? ''} (${context.outcome ?? 'unknown'})`,
    `findings: ${result.summary?.findingsCount ?? result.findings?.length ?? ''}`,
    `new findings: ${result.summary?.newFindingsCount ?? ''}`,
    `pre-existing critical: ${result.summary?.preexistingCriticalCount ?? ''}`,
    `waived: ${result.summary?.waivedCount ?? ''}`,
  ].join('\n');
  return maskSecrets(summary, secrets);
}

export const writeSummary = createSummary;
export const renderSummary = createSummary;

export function discoverControls(input, workspace = process.cwd()) {
  return {
    ignoreFile: input['ignore-file'] ?? discover(workspace, ['.tauditignore']),
    suppressions:
      input.suppressions ?? discover(workspace, ['.taudit-suppressions.yml', join('.taudit', 'suppressions.yml')]),
    baselineRoot: input['baseline-root'] ?? workspace,
    baselineStatus: baselineStatus(input['baseline-root'] ?? workspace),
  };
}

function discover(workspace, relativePaths) {
  for (const relativePath of relativePaths) {
    const absolute = join(workspace, relativePath);
    if (existsSync(absolute)) return relativePath;
  }
  return undefined;
}

function baselineStatus(root) {
  if (!root) return 'unused';
  return existsSync(join(root, '.taudit', 'baselines')) ? 'found' : 'missing';
}

function defaultGate(context) {
  if (context.mode !== 'verify') return 'advisory';
  if (context.gateOnAll) return 'all findings';
  return 'new findings + unwaived critical pre-existing';
}
