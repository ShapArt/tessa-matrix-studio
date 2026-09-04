import fs from 'node:fs';

const mode = process.argv[2];
const file = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  source = source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function installHelper() {
  if (!source.includes('function applyIntervalStructuralProbe(cardStorage, mode) {')) {
    const anchor = `  // Explicit, bounded diagnosis of the unresolved interval error. This collector\n`;
    const helper = `  // Read-only interval diagnostics may test one structural marker at a time on the\n  // detached outgoing duplicate-check storage. The SDK Card itself is never mutated.\n  function applyIntervalStructuralProbe(cardStorage, mode) {\n    const modes = new Set(['clear-interval-changed', 'clear-interval-state', 'clear-interval-markers']);\n    if (!modes.has(mode)) throw new Error(\`Неизвестный режим структурной диагностики: \${mode}\`);\n\n    const sections = cardStorage?.Sections || cardStorage?.sections || {};\n    const section = sections?.[S.Values];\n    const rows = section?.Rows || section?.rows || [];\n    for (const row of rows) {\n      const data = row?.data && typeof row.data === 'object' ? row.data : row;\n      if (!data || typeof data !== 'object') continue;\n      const hasFrom = Object.prototype.hasOwnProperty.call(data, F.IntValue);\n      const hasTo = Object.prototype.hasOwnProperty.call(data, F.IntToValue);\n      if (!hasFrom && !hasTo) continue;\n\n      if (mode === 'clear-interval-changed' || mode === 'clear-interval-markers') {\n        delete row['.changed'];\n        delete row.changed;\n        if (data !== row) { delete data['.changed']; delete data.changed; }\n      }\n      if (mode === 'clear-interval-state' || mode === 'clear-interval-markers') {\n        delete row['.state'];\n        delete row.state;\n        if (data !== row) { delete data['.state']; delete data.state; }\n      }\n    }\n    return cardStorage;\n  }\n\n`;
    replaceOnce(anchor, helper + anchor, 'interval diagnostics helper insertion');
  }

  if (!source.includes('applyIntervalStructuralProbe, collectIntervalDiagnostics')) {
    replaceOnce(
      '    collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,',
      '    applyIntervalStructuralProbe, collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,',
      'test export insertion',
    );
  }
}

function installIntegration() {
  installHelper();

  if (!source.includes('requestTransformMode = null')) {
    replaceOnce(
      '    const probe = async (kind, card, versionId, excelRow = null) => {',
      '    const probe = async (kind, card, versionId, excelRow = null, requestTransformMode = null) => {',
      'probe signature',
    );
  }

  if (!source.includes('applyIntervalStructuralProbe(req.info.card, requestTransformMode);')) {
    replaceOnce(
      `        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });\n        sample.requestSent = true;`,
      `        if (requestTransformMode) {\n          applyIntervalStructuralProbe(req.info.card, requestTransformMode);\n          sample.requestTransformMode = requestTransformMode;\n        }\n        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });\n        sample.requestSent = true;`,
      'outgoing duplicate-check transform',
    );
  }

  if (!source.includes('return sample;\n    };')) {
    replaceOnce(
      `      await assertContext();\n    };\n\n    try {`,
      `      await assertContext();\n      return sample;\n    };\n\n    try {`,
      'probe return sample',
    );
  }

  if (!source.includes("kind: 'saved-rebuilt-clear-interval-changed'")) {
    replaceOnce(
      `          } else await probe('saved-rebuilt', rebuilt, control.versionId);`,
      `          } else {\n            const rebuiltSample = await probe('saved-rebuilt', rebuilt, control.versionId);\n            if (rebuiltSample?.outcome === 'rejected' && rebuiltSample?.code === 'duplicate-interval-extractor') {\n              await probe('saved-rebuilt-clear-interval-changed', rebuilt, control.versionId, null, 'clear-interval-changed');\n              await probe('saved-rebuilt-clear-interval-state', rebuilt, control.versionId, null, 'clear-interval-state');\n              await probe('saved-rebuilt-clear-interval-markers', rebuilt, control.versionId, null, 'clear-interval-markers');\n            }\n          }`,
      'saved rebuilt bounded probes',
    );
  }
}

if (mode === 'helper') installHelper();
else if (mode === 'integration') installIntegration();
else throw new Error(`Unsupported patch mode: ${mode}`);

fs.writeFileSync(file, source, 'utf8');
console.log(`Applied interval probe patch mode=${mode}`);
