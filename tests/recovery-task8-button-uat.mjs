import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.example.test', href: 'https://tessa.example.test/matrix' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const U = globalThis.__TMS_FULL_UAT_V1__;

assert.ok(Array.isArray(E.STUDIO_ACTION_REGISTRY), 'Task8 production action registry missing');
assert.equal(typeof U.actionCoverageFromChecks, 'function', 'Task8 action coverage reducer missing');

const required = [
  'download-current',
  'value-picker',
  'file-ingest',
  'preview',
  'changes-export',
  'dictionary-refresh',
  'merge-current',
  'apply',
  'reconcile',
  'diagnostics',
  'performance-uat',
  'full-uat',
];
const actions = E.STUDIO_ACTION_REGISTRY;
assert.deepEqual(actions.map(item => item.id), required, 'registry must cover the complete Task8 workflow surface in stable order');
assert.equal(new Set(actions.map(item => item.id)).size, actions.length, 'action ids must be unique');
assert.equal(new Set(actions.map(item => item.uatCheckId)).size, actions.length, 'every user action needs its own UAT check id');

const allowedOutcomes = new Set([
  'xlsx-artifact', 'picker-selection', 'ingest-workbook', 'preview-plan', 'changes-xlsx-artifact',
  'refreshed-workbook', 'merged-workbook', 'live-write-readback', 'reconciliation-readback',
  'diagnostic-artifact', 'performance-result', 'full-uat-package',
]);
for (const action of actions) {
  assert.ok(action.selector && /^#|^\./.test(action.selector), `${action.id}: selector missing`);
  assert.ok(['click', 'change'].includes(action.event), `${action.id}: event missing`);
  assert.ok(action.uatCheckId, `${action.id}: uatCheckId missing`);
  assert.ok(allowedOutcomes.has(action.outcome), `${action.id}: outcome must prove a result/artifact, got ${action.outcome}`);
  assert.equal(typeof action.destructive, 'boolean', `${action.id}: destructive flag missing`);
}
assert.equal(actions.find(item => item.id === 'apply')?.destructive, true, 'Apply must stay explicitly destructive');
assert.equal(actions.find(item => item.id === 'full-uat')?.destructive, true, 'Full UAT performs temporary live writes and must stay destructive');
assert.equal(actions.find(item => item.id === 'file-ingest')?.event, 'change');

const checkIdsInRunner = new Set([
  ...source.matchAll(/\b(?:runCheck|addCheck)\(\s*['"]([^'"]+)['"]/g),
].map(match => match[1]));
for (const action of actions) {
  assert.ok(checkIdsInRunner.has(action.uatCheckId), `${action.id}: runner has no concrete check ${action.uatCheckId}`);
}

const simulatedChecks = actions.map(action => ({
  id: action.uatCheckId,
  status: 'PASS',
  detail: `verified ${action.outcome}`,
  data: { outcome: action.outcome, artifact: action.outcome.includes('artifact') ? `${action.id}.bin` : undefined },
}));
const audit = U.actionCoverageFromChecks(simulatedChecks, actions);
assert.equal(audit.total, actions.length);
assert.equal(audit.covered, actions.length);
assert.equal(audit.missing.length, 0);
assert.ok(audit.actions.every(item => item.status === 'PASS' && item.outcomeVerified === true), JSON.stringify(audit, null, 2));

const missing = U.actionCoverageFromChecks(simulatedChecks.slice(1), actions);
assert.equal(missing.covered, actions.length - 1);
assert.deepEqual(missing.missing, ['download-current']);

assert.match(source, /functionalActionAudit/, 'Full UAT report must persist the functional action audit');
assert.match(source, /full-uat-confirmed/, 'Full UAT path must record explicit destructive confirmation evidence');
assert.match(source, /if\s*\(!window\.confirm\([^)]*реальные операции[^)]*\)\)\s*return/s, 'destructive Full UAT must remain behind explicit confirmation');

console.log('Recovery Task8 contract: registry, per-action UAT ids, result/artifact evidence and destructive confirmation OK');
