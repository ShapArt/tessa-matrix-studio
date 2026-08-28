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
const O = E.constants.OPERAND;
const SIGN_FUNCTION = { id: 'function-sign', name: 'Подписание', typeName: 'Подписание' };
const SIGN_ROLE = { id: 'person-1', display: 'Иванов И.И.', roleTypeId: 'role-type' };

function makeCase(operandTypeId, baselineValue = '123') {
  const structure = {
    templateId: 'coercion-template',
    conditions: [{ criterionRowId: 'criterion-value', criterionName: 'Значение', operandTypeId }],
    functions: [SIGN_FUNCTION],
  };
  const flat = { 'criterion:criterion-value': [baselineValue], 'function:function-sign': [SIGN_ROLE.display] };
  const snapshot = {
    matrixId: 'coercion-matrix', templateId: structure.templateId,
    rows: [{ index: 0, rowCardId: 'card-1', versionId: 'version-1', fingerprint: E.fingerprintFlat(flat), values: { 'criterion-value': [{ id: '', display: baselineValue }] }, roles: { 'function-sign': [SIGN_ROLE] }, flat }],
  };
  return { structure, snapshot };
}

async function workbookFor(operandTypeId, baselineValue = '123') {
  const { structure, snapshot } = makeCase(operandTypeId, baselineValue);
  const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
  const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'QA coercion' }, catalog);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const workbook = await E.readXlsxArrayBuffer(buffer, 'qa-coercion.xlsx');
  return { workbook, structure, snapshot, index: workbook.headers.indexOf('Значение') };
}

// Parser must preserve formula presence instead of trusting only cached <v>.
{
  const parsed = E.parseSheetXml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>', [], []);
  assert(parsed.rows[0][0] === '2', `cached formula value parsing changed: ${parsed.rows[0][0]}`);
  assert(parsed.cellMeta?.[0]?.[0]?.hasFormula === true, `formula presence must be preserved in cell metadata: ${JSON.stringify(parsed.cellMeta?.[0]?.[0])}`);
}

// Formula in an editable matrix cell must fail closed even if cached value looks valid.
{
  const { workbook, structure, snapshot, index } = await workbookFor(O.Int, '123');
  workbook.rows[0].values[index] = '124';
  workbook.rows[0].cellMeta[index] = { ...(workbook.rows[0].cellMeta[index] || {}), hasFormula: true, formula: '123+1', rawType: 'n' };
  const plan = E.buildPlan(workbook, structure, snapshot);
  assert(plan.counts.update === 0 && plan.counts.skip === 1, `formula-backed editable cell must be skipped: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);
  assert(plan.skippedRows.some(item => /формул/i.test(item.reason || '')), `formula skip reason must be explicit: ${JSON.stringify(plan.skippedRows)}`);
}

// Scientific/percent/fraction formatting on a String-like criterion is ambiguous after Excel numeric coercion.
for (const [kind, meta] of [
  ['scientific', { numFmtId: 11, formatCode: '0.00E+00' }],
  ['percent', { numFmtId: 10, formatCode: '0.00%' }],
  ['fraction', { numFmtId: 12, formatCode: '# ?/?' }],
]) {
  const { workbook, structure, snapshot, index } = await workbookFor(O.String, '00123');
  workbook.rows[0].values[index] = kind === 'percent' ? '0.5' : '123';
  workbook.rows[0].cellMeta[index] = { styleIndex: 1, ...meta, numberFormatKind: kind, rawType: 'n' };
  const plan = E.buildPlan(workbook, structure, snapshot);
  assert(plan.counts.update === 0 && plan.counts.skip === 1, `${kind} numeric coercion for String must be skipped: ${JSON.stringify(plan.counts)} ${JSON.stringify(plan.skippedRows)}`);
}

// Genuine numeric General/Text values stay valid for Int.
for (const numberFormatKind of ['general', 'text']) {
  const { workbook, structure, snapshot, index } = await workbookFor(O.Int, '123');
  workbook.rows[0].values[index] = '124';
  workbook.rows[0].cellMeta[index] = { styleIndex: 0, numFmtId: numberFormatKind === 'text' ? 49 : 0, formatCode: numberFormatKind === 'text' ? '@' : '', numberFormatKind, rawType: numberFormatKind === 'text' ? 'inlineStr' : 'n' };
  const plan = E.buildPlan(workbook, structure, snapshot);
  assert(plan.counts.update === 1 && plan.counts.skip === 0, `genuine Int (${numberFormatKind}) was blocked: ${JSON.stringify(plan.counts)}`);
}

console.log('TESSA Matrix Studio Excel coercion regressions: OK');
