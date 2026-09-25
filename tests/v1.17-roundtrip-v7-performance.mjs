import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8'));
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const roleEntries = Array.from({ length: 10_403 }, (_, index) => ({
  id: `role-${index}`,
  roleTypeId: index % 10,
  display: `Role ${String(index).padStart(5, '0')}`,
  source: 'MtxRoles',
}));
const otherEntries = Array.from({ length: 10_620 }, (_, index) => ({
  id: `unit-${index}`,
  display: `Unit ${String(index).padStart(5, '0')}`,
  source: 'Units',
}));
const catalogs = {
  units: { id: 'units', label: 'Units', sourceView: 'Units', entries: otherEntries },
};
const columnCatalogIds = { 'criterion:unit': 'units' };
const functions = [];
for (let index = 0; index < 9; index += 1) {
  const id = `function-${index}`;
  functions.push({ id, name: `Function ${index}` });
  catalogs[id] = { id, label: id, sourceView: 'MtxRoles', entries: roleEntries.map(entry => ({ ...entry })) };
  columnCatalogIds[`function:${id}`] = id;
}
const dictionaryCatalog = { catalogs, columnCatalogIds, stats: { errors: [] } };
const logicalEntries = 9 * roleEntries.length + otherEntries.length;
assert.equal(logicalEntries, 104_247);

const started = performance.now();
const artifacts = await E.buildDictionaryRefreshArtifacts(dictionaryCatalog, { sharedStrings: true });
const artifactsMs = performance.now() - started;
assert.equal(artifacts.logicalEntryCount, 104_247);
assert.equal(artifacts.entryCount, roleEntries.length + otherEntries.length,
  'nine equal role catalogs must be physically written once');
assert.equal(artifacts.namedRanges.length, 2);
assert.equal(new Set(functions.map(item => artifacts.physicalCatalogIdByCatalog.get(item.id))).size, 1,
  'all function columns must point to one physical role range');
assert.ok(artifacts.sharedStringsXml?.includes('<sst '), 'V7 must use sharedStrings.xml');

const structure = {
  templateId: 'v7-performance',
  conditions: [{ criterionRowId: 'unit', criterionName: 'Unit', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
  functions,
};
const xlsxStarted = performance.now();
const bytes = await E.createRoundtripXlsxBytes(structure, { matrixId: 'matrix', templateId: structure.templateId, rows: [] }, { TemplateID: structure.templateId }, structuredClone(dictionaryCatalog));
const xlsxMs = performance.now() - xlsxStarted;
assert.ok(bytes.byteLength <= 3 * 1024 * 1024, `V7 control workbook exceeds 3 MiB: ${bytes.byteLength}`);
assert.ok(xlsxMs <= 3_000, `V7 control workbook exceeded 3 s: ${xlsxMs.toFixed(0)} ms`);

console.log(`TESSA Roundtrip V7: logical=${logicalEntries}, physical=${artifacts.entryCount}, artifact=${artifactsMs.toFixed(0)}ms, xlsx=${xlsxMs.toFixed(0)}ms, bytes=${bytes.byteLength}`);
