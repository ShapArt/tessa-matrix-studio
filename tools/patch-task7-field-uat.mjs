import fs from 'node:fs';
import assert from 'node:assert/strict';

const userscriptPath = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(userscriptPath, 'utf8');
const helpers = fs.readFileSync('tools/task7-helpers.fragment.js', 'utf8').trimEnd();
const scenario = fs.readFileSync('tools/task7-scenario.fragment.js', 'utf8').trimEnd();

function replaceOne(before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: source block not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const inventoryAnchor = [
  '  function mutableCriterionColumns(book, catalog, minimum = 2) {',
  "    return (book.schemaTokens || []).map((key, index) => ({ key, index, entries: String(key || '').startsWith('criterion:') ? authoritativeEntries(catalog, key) : [] }))",
  '      .filter(item => item.entries.length >= minimum);',
  '  }',
  '',
  '  function shuffled(array, rng) {',
].join('\n');
const inventoryReplacement = [
  '  function mutableCriterionColumns(book, catalog, minimum = 2) {',
  "    return (book.schemaTokens || []).map((key, index) => ({ key, index, entries: String(key || '').startsWith('criterion:') ? authoritativeEntries(catalog, key) : [] }))",
  '      .filter(item => item.entries.length >= minimum);',
  '  }',
  '',
  helpers,
  '',
  '  function shuffled(array, rng) {',
].join('\n');
replaceOne(inventoryAnchor, inventoryReplacement, 'Task7 writable field inventory helpers');

replaceOne(
  '      rolePresentationAudit: null, recordKeepingAudit: null, writesAttempted: 0, writesCompleted: 0,',
  '      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, writesAttempted: 0, writesCompleted: 0,',
  'Task7 report field mutation audit',
);

const clearScenarioAnchor = "      await runCheck('write-clear-delete', 'Сервер: ADD → очистка поля → read-back → cleanup', async () => {";
replaceOne(clearScenarioAnchor, `${scenario}\n${clearScenarioAnchor}`, 'Task7 live every-field mutation scenario');

replaceOne(
  '  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, runFullUat, installUi };',
  '  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, runFullUat, installUi };',
  'Task7 test/export surface',
);

fs.writeFileSync(userscriptPath, source);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/full-uat-runner-contract.mjs';
assert.ok(pkg.scripts?.test?.includes(marker), 'package test marker missing');
if (!pkg.scripts.test.includes('recovery-task7-field-uat.mjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/recovery-task7-field-uat.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task7 patch applied: every writable field inventory + deterministic candidates + isolated live mutation/read-back/restore evidence');
