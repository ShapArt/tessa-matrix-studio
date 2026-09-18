import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('FULL_UAT_VERSION_PROVENANCE_V1')) {
  const exportsStart = source.indexOf('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {');
  if (exportsStart < 0) throw new Error('Full UAT version provenance: exports object not found');
  const exportsEnd = source.indexOf('\n  };\n\n  bootstrap();', exportsStart);
  if (exportsEnd < 0) throw new Error('Full UAT version provenance: exports object end not found');
  source = source.slice(0, exportsEnd)
    + "\n    // FULL_UAT_VERSION_PROVENANCE_V1\n    studioVersion: () => APP.version,"
    + source.slice(exportsEnd);
}

const reportPattern = /format:\s*'TESSA_FULL_UAT_V1',\s*studioVersion:\s*'[0-9.]+',\s*runnerVersion:\s*VERSION/;
if (reportPattern.test(source)) {
  source = source.replace(
    reportPattern,
    "format: 'TESSA_FULL_UAT_V1', studioVersion: String(E.studioVersion?.() || 'unknown'), runnerVersion: VERSION",
  );
}

if (!source.includes('FULL_UAT_VERSION_PROVENANCE_V1')) {
  throw new Error('Full UAT version provenance marker missing');
}
if (!source.includes("studioVersion: String(E.studioVersion?.() || 'unknown')")) {
  throw new Error('Full UAT report is not bound to the runtime Studio version');
}
if (/format:\s*'TESSA_FULL_UAT_V1',\s*studioVersion:\s*'[0-9.]+'/.test(source)) {
  throw new Error('Full UAT report still contains a hardcoded Studio version');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14.2 Full UAT version provenance transform: OK');
