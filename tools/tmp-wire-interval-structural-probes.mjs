import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'probe signature',
  "    const probe = async (kind, card, versionId, excelRow = null) => {",
  "    const probe = async (kind, card, versionId, excelRow = null, structuralMode = null) => {",
);

replaceOnce(
  'sample metadata',
  "      const sample = { kind, excelRow, versionId, requestSent: false };",
  "      const sample = { kind, excelRow, versionId, requestSent: false };\n      if (structuralMode) sample.structuralMode = structuralMode;",
);

replaceOnce(
  'outgoing request transform',
  "        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });",
  "        if (structuralMode) {\n          if (!req.info?.card) throw new Error('В запросе структурной диагностики отсутствует сериализованная карточка.');\n          applyIntervalStructuralProbe(req.info.card, structuralMode);\n        }\n        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });",
);

replaceOnce(
  'probe result return',
  "      await assertContext();\n    };\n\n    // Pick an existing interval row close to the first candidate.",
  "      await assertContext();\n      return sample;\n    };\n\n    // Pick an existing interval row close to the first candidate.",
);

replaceOnce(
  'rejected rebuilt structural controls',
  "          } else await probe('saved-rebuilt', rebuilt, control.versionId);",
  "          } else {\n            const rebuiltSample = await probe('saved-rebuilt', rebuilt, control.versionId);\n            if (rebuiltSample?.outcome === 'rejected' && rebuiltSample?.code === 'duplicate-interval-extractor') {\n              for (const mode of ['clear-interval-changed', 'clear-interval-state', 'clear-interval-markers']) {\n                await probe(`saved-rebuilt-${mode}`, rebuilt, control.versionId, null, mode);\n              }\n            }\n          }",
);

fs.writeFileSync(path, source);
console.log('Wired bounded interval structural probes into collectIntervalDiagnostics.');
