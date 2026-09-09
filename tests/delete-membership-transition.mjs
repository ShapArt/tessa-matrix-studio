import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.stageMatrixRowDelete === 'function', 'stageMatrixRowDelete export is required');

const Deleted = 3;
const rows = [
  {
    state: 0,
    rowId: 'section-row-1',
    fields: { RowID: 'not-a-card-id', RowRowID: 'version-target', RowName: 'Строка 1' },
  },
  {
    state: 0,
    rowId: 'section-row-2',
    fields: { RowID: 'other-row-id', RowRowID: 'version-other', RowName: 'Строка 2' },
  },
];
const fakeBridge = {
  CardRowState: { Deleted },
  section: () => ({ rows }),
  rowValue: (row, name) => row.fields[name] ?? null,
  isDeleted: row => row.state === Deleted,
};

const outcome = E.stageMatrixRowDelete.call(fakeBridge, 'version-target');
assert(outcome?.staged === true, `target delete must be staged: ${JSON.stringify(outcome)}`);
assert(rows[0].state === Deleted, 'authoritative matrix membership row must be marked Deleted');
assert(rows[1].state === 0, 'unrelated membership row must remain untouched');
assert(outcome.sectionRowId === 'section-row-1', 'diagnostic identity must be the section row id, not a row CardID guess');

let rejected = false;
try { E.stageMatrixRowDelete.call(fakeBridge, 'version-missing'); }
catch (error) { rejected = /не найдена|membership|version/i.test(String(error?.message || error)); }
assert(rejected, 'missing membership must fail closed');

console.log('DELETE must stage an authoritative MtxRouteMatrixRows membership transition: OK');
