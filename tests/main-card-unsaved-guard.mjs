import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const bridge = Object.create(E.TessaBridge.prototype);
bridge.editor = { cardModel: { hasChanges: async () => true } };
await assert.rejects(
  () => bridge.ensureNoUnsavedChanges(),
  /несохран/i,
  'an open matrix with unsaved user edits must fail closed before Studio work starts',
);

bridge.editor.cardModel.hasChanges = async () => false;
await assert.doesNotReject(
  () => bridge.ensureNoUnsavedChanges(),
  'a clean matrix card must pass the unsaved-edit guard',
);

assert.match(
  code,
  /static async create\(\)\s*\{[\s\S]*?new TessaBridge\(\);[\s\S]*?await bridge\.ensureNoUnsavedChanges\(\);[\s\S]*?return bridge;/,
  'every normal TessaBridge.create() must enforce the main-card unsaved-edit guard',
);

console.log('TESSA Matrix Studio main-card unsaved edit guard: OK');
