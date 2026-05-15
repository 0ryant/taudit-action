import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_TAUDIT_VERSION } from './inputs.js';

const execFile = promisify(execFileCallback);

export async function resolveTaudit(input, deps = {}) {
  const exec = deps.execFile ?? execFile;
  const workspace = deps.workspace ?? process.cwd();
  const version = input.version ?? DEFAULT_TAUDIT_VERSION;
  if (deps.tauditPath) return deps.tauditPath;

  try {
    return await installFromRelease(version, workspace, deps);
  } catch (error) {
    if (!input['fallback-cargo']) {
      throw new Error(`taudit release asset install failed and fallback-cargo is false: ${error.message}`);
    }
    await exec('cargo', ['install', 'taudit', '--version', version, '--locked']);
    return 'taudit';
  }
}

export function releaseAssetFor(platform = process.platform, arch = process.arch) {
  const os = platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : null;
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!os || !cpu) throw new Error(`unsupported runner platform ${platform}/${arch}`);
  const ext = os === 'windows' ? 'zip' : 'tar.gz';
  return `taudit-${cpu}-${os}.${ext}`;
}

async function installFromRelease(version, workspace, deps) {
  const asset = releaseAssetFor(deps.platform, deps.arch);
  const tag = version.startsWith('v') ? version : `v${version}`;
  const url = `https://github.com/0ryant/taudit/releases/download/${tag}/${asset}`;
  const checksumUrl = `${url}.sha256`;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  const dir = await mkdtemp(join(tmpdir(), 'taudit-action-'));
  try {
    const archive = join(dir, asset);
    const checksum = join(dir, `${asset}.sha256`);
    await download(fetchImpl, url, archive);
    await download(fetchImpl, checksumUrl, checksum);
    await verifyChecksum(archive, checksum, deps.execFile ?? execFile);
    const binDir = join(workspace, '.taudit-action', 'bin');
    mkdirSync(binDir, { recursive: true });
    const output = join(binDir, process.platform === 'win32' ? 'taudit.exe' : 'taudit');
    await extractArchive(archive, binDir, deps.execFile ?? execFile);
    if (!existsSync(output)) {
      const extracted = join(binDir, basename(output));
      if (!existsSync(extracted)) throw new Error(`taudit binary not found after extracting ${asset}`);
    }
    await chmod(output, 0o755).catch(() => {});
    return output;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function download(fetchImpl, url, path) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`download failed ${response.status} for ${url}`);
  await new Promise((resolve, reject) => {
    const file = createWriteStream(path);
    response.body.pipeTo
      ? response.body
          .pipeTo(
            new WritableStream({
              write(chunk) {
                file.write(Buffer.from(chunk));
              },
              close() {
                file.end(resolve);
              },
              abort(error) {
                file.destroy(error);
                reject(error);
              },
            }),
          )
          .catch(reject)
      : reject(new Error('unsupported fetch body stream'));
  });
}

async function verifyChecksum(archive, checksumFile, exec) {
  const expected = (await readFile(checksumFile, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('invalid checksum file');
  const { stdout } = await exec(process.execPath, ['-e', `
    const { createHash } = require('node:crypto');
    const { readFileSync } = require('node:fs');
    process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));
  `, archive]);
  const actual = stdout.trim().toLowerCase();
  if (actual !== expected) throw new Error('release asset checksum mismatch');
}

async function extractArchive(archive, binDir, exec) {
  if (archive.endsWith('.zip')) {
    await exec('unzip', ['-j', archive, 'taudit.exe', '-d', binDir]);
  } else {
    await exec('tar', ['-xzf', archive, '-C', binDir]);
  }
}
