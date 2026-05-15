export const INPUT_NAMES = [
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

export const DEFAULT_TAUDIT_VERSION = '1.1.4';

const ENUMS = {
  mode: ['verify', 'scan', 'graph'],
  platform: ['auto', 'github-actions', 'azure-devops', 'gitlab', 'bitbucket'],
  'suppression-mode': ['downgrade', 'tag-only'],
  'graph-view': ['authority', 'exploit'],
  'severity-threshold': ['critical', 'high', 'medium', 'low', 'info'],
};

const FORMAT_BY_MODE = {
  scan: ['terminal', 'json', 'sarif', 'cloudevents'],
  verify: ['text', 'json', 'sarif'],
  graph: ['json', 'dot', 'mermaid', 'summary'],
};

const BOOLS = ['include-builtin', 'gate-on-all', 'strict', 'ignore-partial', 'no-color', 'fallback-cargo'];

export function readActionInputs(env = process.env) {
  const raw = {};
  for (const name of INPUT_NAMES) {
    const envName = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
    if (env[envName] != null && env[envName] !== '') raw[name] = env[envName];
  }
  return raw;
}

export function normalizeInputs(raw = {}) {
  rejectUnknown(raw);
  const normalized = {
    mode: raw.mode ?? 'verify',
    paths: raw.paths ?? '.github/workflows/',
    platform: raw.platform ?? 'auto',
    'suppression-mode': raw['suppression-mode'] ?? 'downgrade',
    'graph-view': raw['graph-view'] ?? 'authority',
    'no-color': raw['no-color'] == null ? true : parseBoolean('no-color', raw['no-color']),
  };

  for (const [key, value] of Object.entries(raw)) {
    if (value == null || value === '') continue;
    if (BOOLS.includes(key)) {
      normalized[key] = parseBoolean(key, value);
    } else if (key === 'max-hops') {
      normalized[key] = parsePositiveInteger(key, value);
    } else {
      normalized[key] = String(value);
    }
  }

  validateEnums(normalized);
  validateModeFormat(normalized);
  validateVerifyPolicy(normalized);
  validateAdoAllOrNone(normalized);
  validatePathLikeInputs(normalized);
  return normalized;
}

export const parseInputs = normalizeInputs;
export const validateInputs = normalizeInputs;

export function splitPaths(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rejectUnknown(raw) {
  for (const key of Object.keys(raw)) {
    if (!INPUT_NAMES.includes(key)) {
      throw new Error(`unknown input ${key}`);
    }
  }
}

function validateEnums(input) {
  for (const [key, values] of Object.entries(ENUMS)) {
    if (input[key] != null && !values.includes(input[key])) {
      throw new Error(`invalid ${key}: expected one of ${values.join(', ')}`);
    }
  }
}

function validateModeFormat(input) {
  if (input.format == null) return;
  const formats = FORMAT_BY_MODE[input.mode] ?? [];
  if (!formats.includes(input.format)) {
    throw new Error(`invalid format for ${input.mode}: expected one of ${formats.join(', ')}`);
  }
}

function validateVerifyPolicy(input) {
  if (input.mode === 'verify' && !input.policy) {
    throw new Error('policy is required for verify mode');
  }
}

function validateAdoAllOrNone(input) {
  const keys = ['ado-org', 'ado-project', 'ado-pat'];
  const present = keys.filter((key) => input[key]);
  if (present.length > 0 && present.length < keys.length) {
    const missing = keys.filter((key) => !input[key]);
    throw new Error(`ADO enrichment requires ${missing.join(', ')}`);
  }
}

function validatePathLikeInputs(input) {
  for (const path of splitPaths(input.paths)) {
    validateWorkspacePath('paths', path);
  }
  for (const key of ['policy', 'ignore-file', 'suppressions', 'baseline-root', 'output']) {
    if (input[key]) validateWorkspacePath(key, input[key], { output: key === 'output' });
  }
}

function validateWorkspacePath(name, value, options = {}) {
  const path = String(value);
  if (path.includes('\0') || path.includes('\n') || path.includes('\r')) {
    throw new Error(`${name} must be a single workspace-relative path`);
  }
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`${name} must be workspace-relative`);
  }
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.includes('..')) throw new Error(`${name} must not traverse outside the workspace`);
  if (options.output && (segments[0] === '.git' || (segments[0] === '.github' && segments[1] === 'workflows'))) {
    throw new Error('output must not target repository control or workflow files');
  }
}

function parseBoolean(name, value) {
  if (typeof value === 'boolean') return value;
  const lower = String(value).trim().toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  throw new Error(`invalid boolean for ${name}: expected true or false`);
}

function parsePositiveInteger(name, value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10000 || String(parsed) !== String(value).trim()) {
    throw new Error(`invalid ${name}: expected integer between 1 and 10000`);
  }
  return parsed;
}
