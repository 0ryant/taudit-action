import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertArgvHasPair,
  assertNoFlag,
  assertPathAsData,
  assertRejectsInput,
  buildArgv,
  contractInputs,
  loadActionInputs,
  loadApi,
  loadInputSchema,
  normalizeInputs,
  repoRoot,
  rejectsAsync,
} from './contract-helpers.mjs';

test('input schema rejects unknown keys and invalid enum values', async () => {
  const schema = loadInputSchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.mode.enum, ['verify', 'scan', 'graph']);
  assert.deepEqual(schema.properties.platform.enum, ['auto', 'github-actions', 'azure-devops', 'gitlab', 'bitbucket']);
  assert.deepEqual(schema.properties['suppression-mode'].enum, ['downgrade', 'tag-only']);
  assert.deepEqual(schema.properties['graph-view'].enum, ['authority', 'exploit']);

  await assertRejectsInput({ mode: 'verify', policy: '.taudit/policy', 'extra-args': '--help' }, /unknown|additional|extra-args/i);
  await assertRejectsInput({ mode: 'destroy', policy: '.taudit/policy' }, /mode|enum|invalid/i);
  await assertRejectsInput({ mode: 'verify', policy: '.taudit/policy', platform: 'jenkins' }, /platform|enum|invalid/i);
  await assertRejectsInput({ mode: 'graph', 'graph-view': 'everything' }, /graph-view|enum|invalid/i);
});

test('action metadata and JSON schema stay in sync', () => {
  const actionInputs = loadActionInputs();
  const schema = loadInputSchema();
  const schemaInputs = Object.keys(schema.properties).sort();

  assert.deepEqual([...actionInputs].sort(), contractInputs.slice().sort());
  assert.deepEqual(schemaInputs, contractInputs.slice().sort());
  assert.equal(actionInputs.has('extra-args'), false);
  assert.equal(schemaInputs.includes('extra-args'), false);
});

test('verify without policy fails before invoking CLI', async () => {
  await assertRejectsInput({ mode: 'verify', paths: '.github/workflows/' }, /policy|required/i);

  const run = await loadApi('runner', ['runAction', 'run', 'main']);
  const calls = [];
  await rejectsAsync(
    () => run({
      inputs: { mode: 'verify', paths: '.github/workflows/' },
      execFile: (...args) => {
        calls.push(args);
        throw new Error('execFile must not be called for invalid verify input');
      },
      setSecret: () => {},
      setOutput: () => {},
      summary: { addRaw: () => {}, write: async () => {} },
    }),
    /policy|required/i,
  );
  assert.deepEqual(calls, []);
});

test('verify excludes built-ins by default and includes them only when requested', async () => {
  const withoutBuiltin = await buildArgv({ mode: 'verify', policy: '.taudit/policy', paths: '.github/workflows/' });
  assert.equal(withoutBuiltin[0], 'verify');
  assertNoFlag(withoutBuiltin, '--include-builtin');

  const withBuiltin = await buildArgv({
    mode: 'verify',
    policy: '.taudit/policy',
    paths: '.github/workflows/',
    'include-builtin': 'true',
  });
  assert.equal(withBuiltin.includes('--include-builtin'), true);
});

test('paths and config injection attempts stay argv data, not flags or shell', async () => {
  const injectedPath = '.github/workflows/\n--format\njson\n$(touch owned)';
  const injectedPolicy = '--policy-from-user; echo secret';
  const argv = await buildArgv({
    mode: 'verify',
    policy: injectedPolicy,
    paths: injectedPath,
    'ignore-file': '--not-a-real-flag',
    suppressions: '$(cat ~/.ssh/id_rsa)',
    'baseline-root': 'repo; rm -rf .',
    output: 'out.json && curl attacker',
  });

  assertArgvHasPair(argv, '--policy', injectedPolicy);
  assertArgvHasPair(argv, '--ignore-file', '--not-a-real-flag');
  assertArgvHasPair(argv, '--suppressions', '$(cat ~/.ssh/id_rsa)');
  assertArgvHasPair(argv, '--baseline-root', 'repo; rm -rf .');
  assertArgvHasPair(argv, '-o', 'out.json && curl attacker');
  assertPathAsData(argv, '--format');
  assertPathAsData(argv, 'json');
  assertPathAsData(argv, '$(touch owned)');
});

test('path-like inputs reject workspace escape and output clobber targets', async () => {
  await assertRejectsInput({ mode: 'scan', paths: '../outside.yml' }, /workspace|traverse|paths/i);
  await assertRejectsInput({ mode: 'verify', policy: '/tmp/policy.yml' }, /workspace-relative|policy/i);
  await assertRejectsInput({ mode: 'scan', output: '.git/config' }, /output|workflow|control/i);
  await assertRejectsInput({ mode: 'scan', output: '.github/workflows/release.yml' }, /output|workflow|control/i);
});

test('no extra-args input exists', async () => {
  const actionInputs = loadActionInputs();
  const schema = loadInputSchema();

  assert.equal(actionInputs.has('extra-args'), false);
  assert.equal(Object.hasOwn(schema.properties, 'extra-args'), false);
  await assertRejectsInput({ mode: 'scan', 'extra-args': '--strict' }, /unknown|additional|extra-args/i);
});

test('ADO enrichment is all-or-none and PAT masking is required', async () => {
  await assertRejectsInput({ mode: 'scan', 'ado-org': 'org' }, /ado-project|ado-pat|ado/i);
  await assertRejectsInput({ mode: 'scan', 'ado-project': 'project' }, /ado-org|ado-pat|ado/i);
  await assertRejectsInput({ mode: 'scan', 'ado-pat': 'pat-secret-value' }, /ado-org|ado-project|ado/i);

  const argv = await buildArgv({
    mode: 'scan',
    paths: '.github/workflows/',
    'ado-org': 'org',
    'ado-project': 'project',
    'ado-pat': 'pat-secret-value',
  });
  assertArgvHasPair(argv, '--ado-org', 'org');
  assertArgvHasPair(argv, '--ado-project', 'project');
  assertNoFlag(argv, '--ado-pat');

  const maskSecrets = await loadApi('summary', ['maskSecrets', 'redactSecrets', 'sanitizeSummary']);
  const redacted = maskSecrets('ADO PAT pat-secret-value should not appear', ['pat-secret-value']);
  assert.equal(String(redacted).includes('pat-secret-value'), false);
});

test('suppression-mode tag-only and downgrade map to argv', async () => {
  const tagOnly = await buildArgv({
    mode: 'verify',
    policy: '.taudit/policy',
    suppressions: '.taudit-suppressions.yml',
    'suppression-mode': 'tag-only',
  });
  assertArgvHasPair(tagOnly, '--suppression-mode', 'tag-only');

  const downgrade = await buildArgv({
    mode: 'verify',
    policy: '.taudit/policy',
    suppressions: '.taudit-suppressions.yml',
    'suppression-mode': 'downgrade',
  });
  assertArgvHasPair(downgrade, '--suppression-mode', 'downgrade');
});

test('graph-view authority and exploit map to argv', async () => {
  const authority = await buildArgv({ mode: 'graph', paths: '.github/workflows/', 'graph-view': 'authority' });
  assert.equal(authority[0], 'graph');
  assertArgvHasPair(authority, '--view', 'authority');

  const exploit = await buildArgv({ mode: 'graph', paths: '.github/workflows/', 'graph-view': 'exploit' });
  assert.equal(exploit[0], 'graph');
  assertArgvHasPair(exploit, '--view', 'exploit');
});

test('baseline-root, gate-on-all, and ignore-partial map to argv', async () => {
  const argv = await buildArgv({
    mode: 'verify',
    policy: '.taudit/policy',
    'baseline-root': '.',
    'gate-on-all': 'true',
    'ignore-partial': 'true',
  });

  assertArgvHasPair(argv, '--baseline-root', '.');
  assert.equal(argv.includes('--gate-on-all'), true);
  assert.equal(argv.includes('--ignore-partial'), true);
});

test('summary/output helpers do not leak secret-like fixture values', async () => {
  const fixture = JSON.parse(readFileSync(join(repoRoot, 'fixtures/secret-leakage/taudit-result.json'), 'utf8'));
  const writeSummary = await loadApi('summary', ['createSummary', 'writeSummary', 'renderSummary']);
  const summary = await writeSummary(fixture.result, fixture.context);
  const rendered = typeof summary === 'string' ? summary : JSON.stringify(summary);

  for (const forbidden of fixture.forbiddenSubstrings) {
    assert.equal(rendered.includes(forbidden), false, `summary leaked ${forbidden}`);
  }
  assert.match(rendered, /taudit mode: verify|mode:\s*verify/i);
  assert.match(rendered, /ADO enrichment:\s*configured|ado enrichment.*configured/i);
});

test('boolean and integer inputs are parsed before argv construction', async () => {
  const normalized = await normalizeInputs({
    mode: 'verify',
    policy: '.taudit/policy',
    'include-builtin': 'false',
    'max-hops': '3',
    'no-color': 'true',
  });

  assert.equal(normalized['include-builtin'] ?? normalized.includeBuiltin, false);
  assert.equal(normalized['max-hops'] ?? normalized.maxHops, 3);
  assert.equal(normalized['no-color'] ?? normalized.noColor, true);
  await assertRejectsInput({ mode: 'scan', 'max-hops': '0' }, /max-hops|positive|minimum|invalid/i);
});
