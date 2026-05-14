import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function outcomeFor(exitCode) {
  if (exitCode === 0) {
    return 'pass';
  }
  if (exitCode === 1) {
    return 'violations';
  }
  return 'config-error';
}

export function readJsonReport(inputs) {
  if (!inputs.output || !inputs.format || !['json', 'sarif'].includes(inputs.format)) {
    return undefined;
  }
  const report = join(inputs.workspace, inputs.output);
  if (!existsSync(report)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    return undefined;
  }
}

export function countFindings(report) {
  if (!report) {
    return {};
  }
  if (Array.isArray(report.findings)) {
    return {
      findingsCount: report.findings.length,
      newFindingsCount: report.findings.filter((finding) => finding && finding.baseline_status === 'new').length,
      preexistingCriticalCount: report.findings.filter((finding) => finding && finding.severity === 'critical' && finding.baseline_status === 'preexisting').length,
      waivedCount: report.findings.filter((finding) => finding && (finding.waived || finding.suppressed || finding.baseline_status === 'waived')).length
    };
  }
  if (Array.isArray(report.runs)) {
    const results = report.runs.flatMap((run) => Array.isArray(run.results) ? run.results : []);
    return { findingsCount: results.length };
  }
  const summary = report.summary || report.counts || {};
  return {
    findingsCount: numberOrUndefined(summary.findings || summary.findings_count || summary.total),
    newFindingsCount: numberOrUndefined(summary.new_findings || summary.new_findings_count),
    preexistingCriticalCount: numberOrUndefined(summary.preexisting_critical || summary.preexisting_critical_count),
    waivedCount: numberOrUndefined(summary.waived || summary.waived_count)
  };
}

function numberOrUndefined(value) {
  return Number.isInteger(value) ? value : undefined;
}
