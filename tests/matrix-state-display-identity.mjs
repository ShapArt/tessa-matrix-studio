import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

// Реальная TESSA иногда отдаёт StateName как непрозрачный localization key ($Mtx_Enums_*).
// В таком ключе может вообще не быть слов Draft/Active/Approval, поэтому caption и draft-guard
// обязаны использовать один и тот же результат штатной локализации TESSA.
const stateMap = new Map([
  ['$Mtx_Enums_4F3810A2', 'Черновик'],
  ['$Mtx_Enums_88B17C61', 'Активная'],
  ['$Mtx_Enums_A0126E4D', 'На согласовании'],
]);
const localizeState = value => stateMap.get(String(value)) || String(value);

const draftInfo = { StateName: '$Mtx_Enums_4F3810A2' };
const activeInfo = { StateName: '$Mtx_Enums_88B17C61' };
const approvalInfo = { StateName: '$Mtx_Enums_A0126E4D' };

assert(E.matrixStateCaption(draftInfo, localizeState) === 'Черновик',
  `localized draft caption mismatch: ${E.matrixStateCaption(draftInfo, localizeState)}`);
assert(E.matrixStateCaption(activeInfo, localizeState) === 'Активная',
  `localized active caption mismatch: ${E.matrixStateCaption(activeInfo, localizeState)}`);
assert(E.matrixStateCaption(approvalInfo, localizeState) === 'Согласование',
  `localized approval caption mismatch: ${E.matrixStateCaption(approvalInfo, localizeState)}`);
assert(E.isWritableMatrixDraft(draftInfo, localizeState) === true, 'localized Draft must be writable');
assert(E.isWritableMatrixDraft(activeInfo, localizeState) === false, 'localized Active must remain read-only');
assert(E.isWritableMatrixDraft(approvalInfo, localizeState) === false, 'localized Approval must remain read-only');

const draftBridge = { matrixInfo: () => draftInfo, localizeValue: localizeState };
assert(E.assertWritableMatrixDraft(draftBridge) === draftInfo,
  'assertWritableMatrixDraft must accept a localized Draft state');

let activeError = null;
try {
  E.assertWritableMatrixDraft({ matrixInfo: () => activeInfo, localizeValue: localizeState });
} catch (error) {
  activeError = error;
}
assert(activeError && /Активн/i.test(String(activeError.message || activeError)),
  `Active state must be rejected with localized caption: ${activeError?.message || 'no error'}`);

// Реальный аудит выгрузок показал кейс: ID исполнителя тот же, а display-name роли изменился.
// Это не бизнес-изменение строки и не должно превращаться в UPDATE/SKIP только из-за подписи.
const structure = {
  templateId: 'qa-role-display-template',
  conditions: [],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function row(display) {
  const flat = { 'function:function-sign': [display] };
  return {
    index: 0,
    rowCardId: 'card-role-a',
    versionId: 'version-role-a',
    fingerprint: E.fingerprintFlat(flat),
    values: {},
    roles: {
      'function-sign': [{ id: 'person-stable-id', display, roleTypeId: 'role-type' }],
    },
    flat,
  };
}

const exportedSnapshot = {
  matrixId: 'qa-role-display-matrix',
  templateId: structure.templateId,
  rows: [row('Иванов И.И.')],
};
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, exportedSnapshot);
const bytes = await E.createRoundtripXlsxBytes(
  structure,
  exportedSnapshot,
  { matrixId: exportedSnapshot.matrixId, TemplateID: structure.templateId, TemplateName: 'QA Role Display' },
  catalog,
);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const workbook = await E.readXlsxArrayBuffer(buffer, 'qa-role-display.xlsx');

const currentSnapshot = {
  ...exportedSnapshot,
  rows: [row('Иванов Иван Иванович')],
};
const plan = E.buildPlan(workbook, structure, currentSnapshot);
assert(plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0 && plan.counts.noop === 1,
  `same role ID with changed display must stay NOOP: counts=${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)} warnings=${JSON.stringify(plan.warnings)}`);

console.log('TESSA Matrix Studio localized state + stable role identity regression: OK');
