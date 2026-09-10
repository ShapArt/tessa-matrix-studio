import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://tessa.cherkizovsky.net/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.navigator = dom.window.navigator;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
dom.window.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'), { filename: 'tessa-matrix-studio.user.js' });

const E = dom.window.__TESSA_MATRIX_SYNC_EXPORTS__ || globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert.equal(typeof E.replacementConfirmationModel, 'function', 'replacementConfirmationModel must be exported');
assert.equal(typeof E.confirmCrossMatrixReplacement, 'function', 'confirmCrossMatrixReplacement must be exported');

const plan = {
  actions: [
    { type: 'noop' },
    { type: 'add', excelRow: { excelRow: 15 } },
    { type: 'add', excelRow: { excelRow: 16 } },
    { type: 'delete', currentRow: { index: 2 } },
    { type: 'delete', currentRow: { index: 3 } },
    { type: 'delete', currentRow: { index: 4 } },
  ],
  skippedRows: [],
  crossMatrixReplacement: {
    enabled: true,
    sourceMatrixId: 'matrix-source',
    targetMatrixId: 'matrix-target',
    sourceMatrixName: 'Матрица источник',
    targetMatrixName: 'Матрица цель',
  },
  columnMap: {
    retiredColumns: [{ name: 'Старое поле' }],
    missingCurrentColumns: [{ name: 'Новое поле' }],
  },
};

const model = E.replacementConfirmationModel(plan);
assert.equal(model.keepCount, 1);
assert.equal(model.addCount, 2);
assert.equal(model.deleteCount, 3);
assert.equal(model.sourceMatrixId, 'matrix-source');
assert.equal(model.targetMatrixId, 'matrix-target');
assert.equal(model.retiredColumnCount, 1);
assert.equal(model.missingCurrentColumnCount, 1);
assert.match(model.warning, /замен|удален|перенос/i);

let confirmation = E.confirmCrossMatrixReplacement(plan, document);
let modal = document.querySelector('#tms-replacement-confirm');
assert(modal, 'dedicated replacement confirmation modal was not rendered');
assert.match(modal.textContent, /Матрица источник/);
assert.match(modal.textContent, /Матрица цель/);
assert.match(modal.textContent, /Добавить\s*2/i);
assert.match(modal.textContent, /Удалить\s*3/i);
assert.match(modal.textContent, /Да, выполнить перенос/i);
modal.querySelector('#tms-replacement-confirm-cancel').click();
assert.equal(await confirmation, false, 'Cancel must refuse transfer');
assert.equal(document.querySelector('#tms-replacement-confirm'), null, 'modal must be removed after cancel');

confirmation = E.confirmCrossMatrixReplacement(plan, document);
modal = document.querySelector('#tms-replacement-confirm');
modal.querySelector('#tms-replacement-confirm-yes').click();
assert.equal(await confirmation, true, 'explicit approval must allow transfer');
assert.equal(document.querySelector('#tms-replacement-confirm'), null, 'modal must be removed after approval');

assert.equal(await E.confirmCrossMatrixReplacement({ actions: [] }, document), true, 'ordinary same-matrix Apply must not require transfer modal');

console.log('TESSA Matrix Studio dedicated cross-matrix confirmation UX: OK');
