import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const contractInputs = [
  'mode',
  'version',
  'paths',
  'platform',
  'ado-org',
  'ado-project',
  'ado-pat',
  'policy',
  'include-builtin',
  'ignore-file',
  'suppressions',
  'suppression-mode',
  'baseline-root',
  'gate-on-all',
  'strict',
  'ignore-partial',
  'format',
  'output',
  'graph-view',
  'severity-threshold',
  'max-hops',
  'no-color',
  'fallback-cargo',
];

const moduleCandidates = {
  inputs: ['src/inputs.js', 'src/inputs.mjs', 'src/input-schema.js', 'src/schema.js'],
  argv: ['src/argv.js', 'src/argv.mjs', 'src/command.js', 'src/command-line.js'],
  runner: ['src/index.js', 'src/index.mjs', 'src/main.js', 'src/run.js'],
  summary: ['src/summary.js', 'src/summary.mjs', 'src/output.js', 'src/outputs.js'],
};

export function loadActionInputs() {
  const actionPath = join(repoRoot, 'action.yml');
  assertFile(actionPath, 'root action.yml');
  const text = readFileSync(actionPath, 'utf8');
  const inputs = new Set();
  let inInputs = false;
  let inputIndent = null;

  for (const line of text.split(/\r?\n/)) {
    if (/^inputs:\s*$/.test(line)) {
      inInputs = true;
      inputIndent = null;
      continue;
    }
    if (!inInputs) continue;
    if (/^\S/.test(line) && !/^inputs:\s*$/.test(line)) break;
    const match = line.match(/^(\s{2,})([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (!match) continue;
    if (inputIndent === null) inputIndent = match[1].length;
    if (match[1].length === inputIndent) inputs.add(match[2]);
  }

  return inputs;
}

export function loadInputSchema() {
  const schemaPath = join(repoRoot, 'contracts/taudit-action-inputs.v1.schema.json');
  assertFile(schemaPath, 'contracts/taudit-action-inputs.v1.schema.json');
  return JSON.parse(readFileSync(schemaPath, 'utf8'));
}

export async function loadApi(kind, names) {
  const mod = await loadModule(kind);
  for (const name of names) {
    if (typeof mod[name] === 'function') return mod[name];
    if (typeof mod.default?.[name] === 'function') return mod.default[name];
  }
  throw new Error(`${kind} module must export one of: ${names.join(', ')}`);
}

export async function normalizeInputs(raw) {
  const fn = await loadApi('inputs', ['normalizeInputs', 'parseInputs', 'validateInputs']);
  return fn(raw);
}

export async function buildArgv(raw) {
  const normalized = await normalizeInputs(raw);
  const fn = await loadApi('argv', ['buildArgv', 'buildTauditArgv', 'createArgv']);
  return fn(normalized);
}

export async function assertRejectsInput(raw, pattern) {
  await rejectsAsync(() => normalizeInputs(raw), pattern);
}

export function assertArgvHasPair(argv, flag, value) {
  const index = argv.indexOf(flag);
  if (index === -1) throw new Error(`argv missing ${flag}: ${JSON.stringify(argv)}`);
  if (argv[index + 1] !== value) {
    throw new Error(`argv ${flag} expected ${JSON.stringify(value)}, got ${JSON.stringify(argv[index + 1])}`);
  }
}

export function assertNoFlag(argv, flag) {
  if (argv.includes(flag)) throw new Error(`argv unexpectedly included ${flag}: ${JSON.stringify(argv)}`);
}

export function assertPathAsData(argv, value) {
  const positionals = positionalArgs(argv);
  if (positionals.includes(value)) return;
  throw new Error(`argv must treat ${JSON.stringify(value)} as positional data: ${JSON.stringify(argv)}`);
}

function positionalArgs(argv) {
  const valueFlags = new Set([
    '--policy',
    '--platform',
    '--ado-org',
    '--ado-project',
    '--ado-pat',
    '--ignore-file',
    '--suppressions',
    '--suppression-mode',
    '--baseline-root',
    '--format',
    '-o',
    '--output',
    '--view',
    '--severity-threshold',
    '--max-hops',
  ]);
  const positionals = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (valueFlags.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith('-')) continue;
    positionals.push(value);
  }
  return positionals;
}

export async function rejectsAsync(fn, pattern) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
    if (pattern && !pattern.test(String(error?.message ?? error))) {
      throw new Error(`expected rejection matching ${pattern}, got ${error?.message ?? error}`);
    }
  }
  if (!rejected) throw new Error('expected input to be rejected');
}

async function loadModule(kind) {
  for (const relativePath of moduleCandidates[kind] ?? []) {
    const absolutePath = join(repoRoot, relativePath);
    if (existsSync(absolutePath)) return import(pathToFileURL(absolutePath).href);
  }
  throw new Error(`${kind} module missing; expected one of: ${(moduleCandidates[kind] ?? []).join(', ')}`);
}

function assertFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing at ${path}`);
}
