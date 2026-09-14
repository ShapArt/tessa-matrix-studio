import fs from 'node:fs';

const mode = process.argv[2] || '';
const sourcePath = 'tessa-matrix-studio.user.js';
const transformPath = 'hotfixes/v1.13.0-user-row-lifecycle-transform.mjs';

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one source match, got ${count}`);
  return text.replace(from, to);
}

function patchCanonicalSource() {
  let text = fs.readFileSync(sourcePath, 'utf8');
  text = replaceOnce(
    text,
    "    if (generated && columns) for (const column of columns.values()) {",
    "    const diagnosticNativeCardCache = new Map();\n    const getDiagnosticNativeCard = async row => {\n      const key = canonicalValue(row?.rowCardId);\n      if (!key) throw new Error('У контрольной строки отсутствует CardID.');\n      if (!diagnosticNativeCardCache.has(key)) diagnosticNativeCardCache.set(key, await bridge.getCard(row.rowCardId));\n      return diagnosticNativeCardCache.get(key);\n    };\n    if (generated && columns) for (const column of columns.values()) {",
    'canonical diagnostic native-card cache',
  );
  text = replaceOnce(
    text,
    "      await run(`field-${column.key}`, `Поле: ${column.name || column.excelHeader}`, async () => {",
    "      await run(`field-${column.key}`, `Поле «${column.name || column.excelHeader}»`, async () => {",
    'canonical diagnostic field title clarity',
  );
  text = replaceOnce(
    text,
    "        // Snapshot rows are deliberately plain DTOs and must never retain a live TESSA Card.\n        // Reopen only the one control row needed by this read-only diagnostic, then clone it locally.\n        const liveCard = await bridge.getCard(controlRow.rowCardId);\n        if (!liveCard?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };",
    "        // Snapshot rows are deliberately plain DTOs and must never retain a live TESSA Card.\n        // Reopen only the control rows needed by diagnostics and reuse them within this run.\n        const nativeCard = await getDiagnosticNativeCard(controlRow);\n        if (typeof nativeCard?.clone !== 'function') return { status: 'not-run', detail: 'Нативная карточка строки не поддерживает clone().' };",
    'canonical diagnostic card hydration',
  );
  text = replaceOnce(
    text,
    "        const cloned = liveCard.clone();",
    "        const cloned = nativeCard.clone();",
    'canonical diagnostic card clone',
  );
  fs.writeFileSync(sourcePath, text);
}

function patchTransform() {
  let text = fs.readFileSync(transformPath, 'utf8');
  const start = text.indexOf('// Snapshot rows intentionally cross a DTO boundary');
  const end = text.indexOf('// Full UAT packages use the same audited ZIP writer', start);
  if (start < 0 || end < 0 || end <= start) throw new Error('diagnostics transform block not found');
  const replacement = `// Snapshot rows intentionally cross a DTO boundary and no longer retain native Card\n// instances. Since v1.14 this logic also lives in canonical source. Keep the transform\n// backwards-compatible for older source snapshots, but make it idempotent for v1.14+.\nif (!source.includes('const diagnosticNativeCardCache = new Map();')) {\n  replaceExact(\n\`    if (generated && columns) for (const column of columns.values()) {\`,\n\`    const diagnosticNativeCardCache = new Map();\n    const getDiagnosticNativeCard = async row => {\n      const key = canonicalValue(row?.rowCardId);\n      if (!key) throw new Error('У контрольной строки отсутствует CardID.');\n      if (!diagnosticNativeCardCache.has(key)) diagnosticNativeCardCache.set(key, await bridge.getCard(row.rowCardId));\n      return diagnosticNativeCardCache.get(key);\n    };\n    if (generated && columns) for (const column of columns.values()) {\`,\n    'diagnostic native-card cache',\n  );\n  replaceExact(\n\`      await run(\\\`field-\\${column.key}\\\`, \\\`Поле: \\${column.name || column.excelHeader}\\\`, async () => {\`,\n\`      await run(\\\`field-\\${column.key}\\\`, \\\`Поле «\\${column.name || column.excelHeader}»\\\`, async () => {\`,\n    'diagnostic field title clarity',\n  );\n  if (source.includes(\"        if (!controlRow.card?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };\")) {\n    replaceExact(\n\`        if (!controlRow.card?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };\`,\n\`        const nativeCard = await getDiagnosticNativeCard(controlRow);\n        if (typeof nativeCard?.clone !== 'function') return { status: 'not-run', detail: 'Нативная карточка строки не поддерживает clone().' };\`,\n      'diagnostic field card hydration',\n    );\n    replaceExact(\n\`        const cloned = controlRow.card.clone();\`,\n\`        const cloned = nativeCard.clone();\`,\n      'diagnostic field card clone',\n    );\n  } else {\n    replaceExact(\n\`        // Snapshot rows are deliberately plain DTOs and must never retain a live TESSA Card.\n        // Reopen only the one control row needed by this read-only diagnostic, then clone it locally.\n        const liveCard = await bridge.getCard(controlRow.rowCardId);\n        if (!liveCard?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };\`,\n\`        // Snapshot rows are deliberately plain DTOs and must never retain a live TESSA Card.\n        // Reopen only the control rows needed by diagnostics and reuse them within this run.\n        const nativeCard = await getDiagnosticNativeCard(controlRow);\n        if (typeof nativeCard?.clone !== 'function') return { status: 'not-run', detail: 'Нативная карточка строки не поддерживает clone().' };\`,\n      'diagnostic field card hydration from direct-source fix',\n    );\n    replaceExact(\n\`        const cloned = liveCard.clone();\`,\n\`        const cloned = nativeCard.clone();\`,\n      'diagnostic field card clone from direct-source fix',\n    );\n  }\n}\n\n`;
  text = text.slice(0, start) + replacement + text.slice(end);
  fs.writeFileSync(transformPath, text);
}

function verify() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transform = fs.readFileSync(transformPath, 'utf8');
  for (const marker of [
    'const diagnosticNativeCardCache = new Map();',
    'await bridge.getCard(row.rowCardId)',
    'Поле «${column.name || column.excelHeader}»',
    'const cloned = nativeCard.clone();',
  ]) if (!source.includes(marker)) throw new Error(`canonical source marker missing: ${marker}`);
  if (!transform.includes("if (!source.includes('const diagnosticNativeCardCache = new Map();'))")) throw new Error('transform is not idempotent');
  if (source.includes('controlRow.card?.clone') || source.includes('controlRow.card.clone()')) throw new Error('canonical source still expects Card in snapshot DTO');
}

if (mode === '--apply') {
  patchCanonicalSource();
  patchTransform();
  verify();
} else if (mode === '--verify') verify();
else throw new Error('Usage: node tools/patch-v1.14-canonicalize-diagnostics.mjs --apply|--verify');
