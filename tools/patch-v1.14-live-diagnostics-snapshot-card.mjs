import fs from 'node:fs';

const mode = process.argv[2] || '';
const sourcePath = 'tessa-matrix-studio.user.js';
const testPath = 'tests/studio-diagnostics.mjs';

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one source match, got ${count}`);
  return text.replace(from, to);
}

function patchTest() {
  let text = fs.readFileSync(testPath, 'utf8');
  text = replaceOnce(
    text,
    "    async loadSnapshot() { const response = await this.cardService.get({ cardId: 'saved-card' }); return { ...snapshot, rows: [{ ...original, card: response.card }] }; },",
    "    async loadSnapshot() { await this.cardService.get({ cardId: 'saved-card' }); return { ...snapshot, rows: [{ ...original }] }; },",
    'studio diagnostics fixture must model the serializable snapshot DTO boundary',
  );
  text = replaceOnce(
    text,
    "const result = await collect(f);\nassert.equal(result.report.status, 'passed', JSON.stringify(result.report.checks));",
    "const result = await collect(f);\nconst criterionFieldCheck = result.report.checks.find(c => c.id === 'field-criterion:pages');\nconst functionFieldCheck = result.report.checks.find(c => c.id === 'field-function:sign');\nassert.notEqual(criterionFieldCheck?.status, 'not-run', 'criterion diagnostics must reopen the live row card instead of expecting it inside snapshot DTO');\nassert.notEqual(functionFieldCheck?.status, 'not-run', 'function diagnostics must reopen the live row card instead of expecting it inside snapshot DTO');\nassert.equal(result.report.status, 'passed', JSON.stringify(result.report.checks));",
    'studio diagnostics live-card regression assertions',
  );
  fs.writeFileSync(testPath, text);
}

function patchImplementation() {
  let text = fs.readFileSync(sourcePath, 'utf8');
  text = replaceOnce(
    text,
    "        if (!controlRow.card?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };\n        const desired = desiredFromRow(controlRow);\n        desired.flat[column.key] = []; desired.ids[column.key] = [];\n        const cloned = controlRow.card.clone();",
    "        // Snapshot rows are deliberately plain DTOs and must never retain a live TESSA Card.\n        // Reopen only the one control row needed by this read-only diagnostic, then clone it locally.\n        const liveCard = await bridge.getCard(controlRow.rowCardId);\n        if (!liveCard?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };\n        const desired = desiredFromRow(controlRow);\n        desired.flat[column.key] = []; desired.ids[column.key] = [];\n        const cloned = liveCard.clone();",
    'studio diagnostics must reopen the live row card',
  );
  fs.writeFileSync(sourcePath, text);
}

if (mode === '--test') patchTest();
else if (mode === '--implementation') patchImplementation();
else throw new Error('Usage: node tools/patch-v1.14-live-diagnostics-snapshot-card.mjs --test|--implementation');
