import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [
  ['src', new Set(['.js'])],
  ['scripts', new Set(['.mjs'])],
  ['test', new Set(['.mjs'])],
];

const files = ['bin/taudit-action'];

for (const [root, extensions] of roots) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : entry.name.slice(dot);
    if (extensions.has(extension)) files.push(join(root, entry.name));
  }
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status === 0) continue;
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}
