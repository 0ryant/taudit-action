import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { buildArgv } from './argv.js';
import { normalizeInputs, readActionInputs } from './inputs.js';
import { resolveTaudit } from './installer.js';
import { createSummary, discoverControls } from './summary.js';

const execFile = promisify(execFileCallback);

export async function runAction(deps = {}) {
  const raw = deps.inputs ?? readActionInputs(deps.env ?? process.env);
  const input = normalizeInputs(raw);
  const secrets = [input['ado-pat']].filter(Boolean);
  for (const secret of secrets) setSecret(secret, deps);

  const taudit = await resolveTaudit(input, deps);
  const argv = buildArgv(input);
  const result = await runTaudit(taudit, argv, deps.execFile ?? execFile, input);
  const outcome = outcomeFor(result.exitCode);
  const controls = discoverControls(input, deps.workspace ?? process.cwd());
  const context = contextFor(input, result, controls, outcome, secrets);
  const summary = createSummary(result.parsed ?? {}, context);

  setOutputs(context, input, result, deps);
  await writeStepSummary(summary, deps);

  if (result.exitCode !== 0) {
    const error = new Error(`taudit exited ${result.exitCode}`);
    error.exitCode = result.exitCode;
    throw error;
  }
  return { input, argv, result, context, summary };
}

export const run = runAction;
export const main = runAction;

async function runTaudit(binary, argv, exec, input) {
  const env = input['ado-pat'] ? { ...process.env, TAUDIT_ADO_PAT: input['ado-pat'] } : process.env;
  try {
    const { stdout = '', stderr = '' } = await exec(binary, argv, { shell: false, env });
    return { exitCode: 0, stdout, stderr, parsed: parseJson(stdout) };
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : 2;
    return {
      exitCode,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message ?? error),
      parsed: parseJson(error.stdout ?? ''),
    };
  }
}

function contextFor(input, result, controls, outcome, secrets) {
  return {
    mode: input.mode,
    tauditVersion: input.version ?? '1.1.2',
    policyPath: input.policy,
    includeBuiltin: Boolean(input['include-builtin']),
    ignoreFile: controls.ignoreFile,
    suppressions: controls.suppressions,
    suppressionMode: input['suppression-mode'] ?? 'downgrade',
    baselineRoot: controls.baselineRoot,
    baselineStatus: controls.baselineStatus,
    partialPolicy: input['ignore-partial'] ? 'ignore-partial' : 'normal',
    adoEnrichment: input['ado-pat'] ? 'configured' : 'unused',
    gateOnAll: Boolean(input['gate-on-all']),
    exitCode: result.exitCode,
    outcome,
    secrets,
  };
}

function setOutputs(context, input, result, deps) {
  const parsedSummary = result.parsed?.summary ?? {};
  const output = (name, value) => setOutput(name, value ?? '', deps);
  output('exit-code', String(result.exitCode));
  output('outcome', context.outcome);
  output('report-path', input.output ?? '');
  output('graph-path', input.mode === 'graph' ? input.output ?? '' : '');
  output('findings-count', parsedSummary.findingsCount ?? result.parsed?.findings?.length ?? '');
  output('policy-path', context.policyPath ?? '');
  output('ignore-file-used', context.ignoreFile ?? '');
  output('suppressions-file-used', context.suppressions ?? '');
  output('suppression-mode-used', context.suppressionMode);
  output('baseline-root-used', context.baselineRoot ?? '');
  output('baseline-status', context.baselineStatus);
  output('partial-policy', context.partialPolicy);
  output('ado-enrichment', context.adoEnrichment);
  output('new-findings-count', parsedSummary.newFindingsCount ?? '');
  output('preexisting-critical-count', parsedSummary.preexistingCriticalCount ?? '');
  output('waived-count', parsedSummary.waivedCount ?? '');
  output('taudit-version', context.tauditVersion);
}

function setOutput(name, value, deps) {
  const normalized = String(value);
  if (typeof deps.setOutput === 'function') {
    deps.setOutput(name, normalized);
    return;
  }
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, formatGithubOutput(name, normalized));
}

function formatGithubOutput(name, value) {
  if (!value.includes('\n') && !value.includes('\r')) {
    return `${name}=${value}\n`;
  }
  let delimiter = `taudit_${randomUUID()}`;
  while (value.includes(delimiter)) {
    delimiter = `taudit_${randomUUID()}`;
  }
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

function setSecret(value, deps) {
  if (typeof deps.setSecret === 'function') {
    deps.setSecret(value);
    return;
  }
  process.stdout.write(`::add-mask::${value}\n`);
}

async function writeStepSummary(text, deps) {
  if (deps.summary && typeof deps.summary.addRaw === 'function') {
    deps.summary.addRaw(text);
    if (typeof deps.summary.write === 'function') await deps.summary.write();
    return;
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function outcomeFor(exitCode) {
  if (exitCode === 0) return 'pass';
  if (exitCode === 1) return 'violations';
  return 'config-error';
}

function parseJson(text) {
  if (!text || !String(text).trim().startsWith('{')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAction().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode ?? 2);
  });
}
