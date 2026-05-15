import { splitPaths } from './inputs.js';

export function buildArgv(input) {
  const argv = [input.mode];
  addPair(argv, '--platform', input.platform ?? 'auto');
  addPair(argv, '--ado-org', input['ado-org']);
  addPair(argv, '--ado-project', input['ado-project']);
  addPair(argv, '--max-hops', input['max-hops'] == null ? undefined : String(input['max-hops']));

  if (input.mode === 'verify') {
    addPair(argv, '--policy', input.policy);
    addFlag(argv, '--include-builtin', input['include-builtin']);
    addFlag(argv, '--gate-on-all', input['gate-on-all']);
    addFlag(argv, '--strict', input.strict);
    addFlag(argv, '--ignore-partial', input['ignore-partial']);
  }

  if (input.mode === 'graph') {
    addPair(argv, '--view', input['graph-view'] ?? 'authority');
  } else {
    addPair(argv, '--ignore-file', input['ignore-file']);
    addPair(argv, '--suppressions', input.suppressions);
    addPair(argv, '--suppression-mode', input['suppression-mode']);
    addPair(argv, '--baseline-root', input['baseline-root']);
    addPair(argv, '--severity-threshold', input['severity-threshold']);
    addFlag(argv, '--no-color', input['no-color']);
    addPair(argv, '-o', input.output);
  }

  addPair(argv, '--format', input.format);

  argv.push('--');
  for (const path of splitPaths(input.paths)) argv.push(path);
  return argv;
}

export const buildTauditArgv = buildArgv;
export const createArgv = buildArgv;

function addPair(argv, flag, value) {
  if (value == null || value === '') return;
  argv.push(flag, String(value));
}

function addFlag(argv, flag, enabled) {
  if (enabled) argv.push(flag);
}
