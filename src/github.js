import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';

export function inputEnvName(name) {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

export function getInput(name) {
  const primary = process.env[inputEnvName(name)];
  if (primary !== undefined) {
    return primary.trim();
  }
  const underscore = process.env[`INPUT_${name.replace(/[- ]/g, '_').toUpperCase()}`];
  return underscore === undefined ? '' : underscore.trim();
}

export function addMask(value) {
  if (value) {
    process.stdout.write(`::add-mask::${value}${EOL}`);
  }
}

export function setOutput(name, value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${name}=${normalized}${EOL}`, { encoding: 'utf8' });
    return;
  }
  process.stdout.write(`::set-output name=${name}::${normalized}${EOL}`);
}

export function appendSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    return;
  }
  appendFileSync(file, `${lines.join(EOL)}${EOL}`, { encoding: 'utf8' });
}

export function fail(message) {
  process.stdout.write(`::error::${message}${EOL}`);
}
