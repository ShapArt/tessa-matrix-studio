import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_NAMES = [
  'MtxRouteMatrixRowVersions',
  'MtxRouteMatrixRowVersionValues',
  'MtxRouteMatrixRowVersionRoles',
];

function unwrap(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$__value')) {
    return value.$__value;
  }
  return value;
}

function rowsOf(section) {
  const rows = section?.Rows ?? section?.rows;
  return Array.isArray(rows) ? rows : [];
}

function numericState(row) {
  const value = unwrap(row?.['.state']);
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function summarizeSection(section) {
  const rows = rowsOf(section);
  const states = {};
  const changed = new Set();

  for (const row of rows) {
    const state = numericState(row);
    if (state !== null) states[String(state)] = (states[String(state)] || 0) + 1;

    const fields = row?.['.changed'];
    if (Array.isArray(fields)) {
      for (const field of fields) {
        const value = unwrap(field);
        if (typeof value === 'string' && value) changed.add(value);
      }
    }
  }

  return {
    rowCount: rows.length,
    states,
    changedFields: [...changed].sort(),
  };
}

function summarizeIntervals(valuesSection) {
  const result = [];
  for (const row of rowsOf(valuesSection)) {
    const from = unwrap(row?.IntValue);
    const to = unwrap(row?.IntToValue);
    const hasFrom = from !== null && from !== undefined;
    const hasTo = to !== null && to !== undefined;
    if (!hasFrom && !hasTo) continue;

    result.push({
      criterionIdPresent: Boolean(unwrap(row?.CriterionRowID)),
      hasFrom,
      hasTo,
      rowState: numericState(row),
    });
  }
  return result;
}

function validationMessageFingerprint(sample) {
  const direct = typeof sample?.message === 'string' ? sample.message : '';
  const itemMessages = sample?.response?.ValidationResult?.Items;
  const fallback = Array.isArray(itemMessages)
    ? itemMessages.map(item => unwrap(item?.Message)).find(value => typeof value === 'string') || ''
    : '';
  const source = direct || fallback;
  if (!source) return '';

  const parts = [];
  if (/LeftOperandExtractor\s+is\s+null/i.test(source)) parts.push('LeftOperandExtractor is null');
  const guids = [...new Set(source.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])]
    .map(value => value.toLowerCase())
    .sort();
  if (guids.length) parts.push(`guids:${guids.join(',')}`);
  return parts.join(' | ');
}

function summarizeSample(sample) {
  const card = sample?.request?.Info?.card || sample?.request?.info?.card || {};
  const sectionsSource = card?.Sections || card?.sections || {};
  const sections = {};
  for (const name of SECTION_NAMES) sections[name] = summarizeSection(sectionsSource?.[name]);

  const versionRaw = unwrap(card?.Version ?? card?.version);
  const version = Number.isFinite(Number(versionRaw)) ? Number(versionRaw) : null;

  return {
    kind: String(sample?.kind || 'unknown'),
    outcome: String(sample?.outcome || 'unknown'),
    requestSent: sample?.requestSent === true,
    card: {
      version,
      idPresent: Boolean(unwrap(card?.ID ?? card?.id)),
    },
    sections,
    intervalShapes: summarizeIntervals(sectionsSource?.MtxRouteMatrixRowVersionValues),
    validation: {
      code: typeof sample?.code === 'string' ? sample.code : null,
      messageFingerprint: validationMessageFingerprint(sample),
    },
  };
}

function flattenStructural(value, prefix = '', output = new Map()) {
  if (Array.isArray(value)) {
    output.set(prefix, JSON.stringify(value));
    return output;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length && prefix) output.set(prefix, '{}');
    for (const [key, child] of entries) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenStructural(child, next, output);
    }
    return output;
  }
  if (prefix) output.set(prefix, value);
  return output;
}

function structuralProjection(sample) {
  return {
    card: sample.card,
    sections: sample.sections,
    intervalShapes: sample.intervalShapes,
  };
}

function structuralDiff(left, right) {
  const leftFlat = flattenStructural(structuralProjection(left));
  const rightFlat = flattenStructural(structuralProjection(right));
  const keys = [...new Set([...leftFlat.keys(), ...rightFlat.keys()])].sort();
  const changedPaths = keys.filter(key => !Object.is(leftFlat.get(key), rightFlat.get(key)));
  return { left: left.kind, right: right.kind, changedPaths };
}

export function buildIntervalReproSummary(report) {
  if (!report || report.format !== 'TESSA_INTERVAL_DIAGNOSTICS_V1') {
    throw new Error('Unsupported interval diagnostics format');
  }

  const samples = Array.isArray(report.samples) ? report.samples.map(summarizeSample) : [];
  const baseline = samples.find(sample => sample.kind === 'saved-original') || samples[0] || null;
  const diffs = baseline
    ? samples.filter(sample => sample !== baseline).map(sample => structuralDiff(baseline, sample))
    : [];

  return {
    format: 'TESSA_INTERVAL_REPRO_SUMMARY_V1',
    sourceFormat: report.format,
    studioVersion: typeof report.studioVersion === 'string' ? report.studioVersion : null,
    writesAttempted: Number(report.writesAttempted) || 0,
    containsBusinessData: false,
    samples,
    diffs,
  };
}

function runCli() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: node tools/interval-repro-summary.mjs <diagnostics.json> [summary.json]');
    process.exitCode = 2;
    return;
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const summary = buildIntervalReproSummary(input);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) runCli();
