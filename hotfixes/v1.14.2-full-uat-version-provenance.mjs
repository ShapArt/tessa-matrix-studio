import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('FULL_UAT_VERSION_PROVENANCE_V1')) {
  const exportNeedle = `    TessaBridge,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },`;
  if (!source.includes(exportNeedle)) {
    throw new Error('Full UAT version provenance: exports anchor not found');
  }
  source = source.replace(
    exportNeedle,
    `    // FULL_UAT_VERSION_PROVENANCE_V1
    studioVersion: () => APP.version,
    TessaBridge,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },`,
  );
}

const reportNeedle = `format: 'TESSA_FULL_UAT_V1', studioVersion: '1.14.0', runnerVersion: VERSION`;
if (source.includes(reportNeedle)) {
  source = source.replace(
    reportNeedle,
    `format: 'TESSA_FULL_UAT_V1', studioVersion: String(E.studioVersion?.() || 'unknown'), runnerVersion: VERSION`,
  );
}

if (!source.includes('FULL_UAT_VERSION_PROVENANCE_V1')) {
  throw new Error('Full UAT version provenance marker missing');
}
if (!source.includes("studioVersion: String(E.studioVersion?.() || 'unknown')")) {
  throw new Error('Full UAT report is not bound to the runtime Studio version');
}
if (source.includes("format: 'TESSA_FULL_UAT_V1', studioVersion: '1.14.0'")) {
  throw new Error('Full UAT report still contains stale hardcoded Studio version');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14.2 Full UAT version provenance transform: OK');
