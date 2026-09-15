import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

// Static safety contract: fix the reported normal-workbook false positive without removing
// the independent ZIP-bomb guards that xlsx-archive-security.mjs exercises dynamically.
assert.match(code, /MaxInputBytes:\s*32 \* 1024 \* 1024,/);
assert.match(code, /MaxEntries:\s*256,/);
assert.match(code, /MaxEntryUncompressedBytes:\s*128 \* 1024 \* 1024,/);
assert.match(code, /MaxTotalUncompressedBytes:\s*512 \* 1024 \* 1024,/);
assert.match(code, /MaxCompressionRatio:\s*100,/);

// Product contract: without an explicitly selected workbook production must go to TESSA,
// not demand that the user export Excel first. A TEST_MODE-only APP fallback is permitted so
// DOM regressions can exercise picker rendering without pretending to host TESSA.
assert.match(code, /else \{\s*source = await loadLivePickerSource\(\);\s*\}/);
assert.match(code, /window\.__TESSA_MATRIX_SYNC_TEST_MODE__ && APP\.structure && APP\.snapshot && APP\.dictionaryCatalog/);
assert.doesNotMatch(code, /Сначала скачайте Excel или выберите рабочую книгу со справочниками\./);
assert.doesNotMatch(code, /В книге нет справочников для выбора\. Скачайте Excel со справочниками\./);
assert.match(code, /В текущей матрице не удалось получить справочники для выбора\. Обновите карточку матрицы и повторите\./);
assert.match(code, /loadDictionaryCatalog\(structure, snapshot, \{ forceRefresh: true \}\)/);

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = {
  body: { innerText: '' },
  querySelector: () => null,
  querySelectorAll: () => [],
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.loadLivePickerSource, 'function', 'live TESSA picker loader must be exported for regression testing');

const calls = [];
const structure = { templateId: 'tpl-task11', conditions: [], functions: [] };
const snapshot = { matrixId: 'matrix-task11', templateId: 'tpl-task11', rows: [] };
const catalog = { catalogs: {}, columnCatalogIds: {}, stats: { errors: [] } };
const fakeBridge = {
  templateId() {
    calls.push('templateId');
    return 'tpl-task11';
  },
  async requestStructure(templateId) {
    calls.push(`requestStructure:${templateId}`);
    return structure;
  },
  async loadSnapshot(value) {
    calls.push(`loadSnapshot:${value === structure}`);
    return snapshot;
  },
  async loadDictionaryCatalog(structureArg, snapshotArg, options) {
    calls.push(`loadDictionaryCatalog:${structureArg === structure}:${snapshotArg === snapshot}:${options?.forceRefresh === true}`);
    return catalog;
  },
};

const source = await E.loadLivePickerSource(fakeBridge);
assert.deepEqual(calls, [
  'templateId',
  'requestStructure:tpl-task11',
  'loadSnapshot:true',
  'loadDictionaryCatalog:true:true:true',
]);
assert.ok(Array.isArray(source.headers), 'picker source must expose headers');
assert.ok(Array.isArray(source.schemaTokens), 'picker source must expose schema tokens');
assert.equal(source.dictionaryCatalog, catalog, 'picker must use the fresh TESSA dictionary catalog');

console.log('Task11 regressions: production picker bootstraps directly from TESSA; no-Excel guidance is preserved; XLSX aggregate ceiling is raised without weakening independent guards: OK');
