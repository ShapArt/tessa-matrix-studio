import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText);
  assert.notEqual(first, -1, `${label}: source anchor not found`);
  assert.equal(source.indexOf(oldText, first + oldText.length), -1, `${label}: source anchor is not unique`);
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

// Task11-A: a normal large XLSX must not be rejected by the old aggregate ceiling.
// Keep the input, per-entry, entry-count and compression-ratio guards intact; only the
// aggregate expanded OPC budget is raised. Browser parsing still fails closed above it.
if (!source.includes('MaxTotalUncompressedBytes: 512 * 1024 * 1024,')) {
  replaceOnce(
    'MaxTotalUncompressedBytes: 256 * 1024 * 1024,',
    'MaxTotalUncompressedBytes: 512 * 1024 * 1024,',
    'Task11 XLSX aggregate ceiling',
  );
}

// Task11-B: "Собрать значение" must bootstrap itself from the matrix currently open in
// TESSA. Excel is an optional source, not a prerequisite for loading current dictionaries.
if (!source.includes('async function loadLivePickerSource(')) {
  const oldBlock = `  // Only read a local workbook or the already downloaded dictionary. This picker
  // never writes to Excel or TESSA; the user reviews the resulting workbook.
  async function openValuePicker() {
    const file = document.querySelector('#tms-file')?.files?.[0];
    let source;
    if (file) source = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    else if (APP.structure && APP.snapshot && APP.dictionaryCatalog) {
      const grid = buildRoundtripGrid(APP.structure, APP.snapshot, {}, APP.dictionaryCatalog);
      source = { headers: grid.columns.map(c => c.header), schemaTokens: grid.columns.map(c => c.schema), dictionaryCatalog: grid.dictionaryCatalog };
    }
    if (!source) throw new Error('Сначала скачайте Excel или выберите рабочую книгу со справочниками.');
    const columns = pickerColumns(source);`;

  const newBlock = `  // Load fresh matrix metadata and dictionaries straight from TESSA for the value
  // picker. This is deliberately read-only: no Excel is generated and no matrix rows are
  // written. A bridge override exists only for deterministic Node regressions.
  async function loadLivePickerSource(bridgeOverride = null) {
    setProgress(8, 'Подключаюсь к TESSA', 'Готовлю справочники для выбора значений');
    const bridge = bridgeOverride || await TessaBridge.create();
    const templateId = bridge.templateId();
    if (!templateId) throw new Error('У матрицы не найден TemplateID.');

    setProgress(28, 'Читаю структуру', 'Критерии и функции текущей матрицы');
    const structure = await performanceStage(
      'picker.structure',
      () => bridge.requestStructure(templateId),
      { operation: 'picker' },
    );

    setProgress(48, 'Читаю матрицу', 'Получаю текущее состояние из TESSA');
    const snapshot = await performanceStage(
      'picker.snapshot',
      () => bridge.loadSnapshot(structure),
      { operation: 'picker' },
    );

    setProgress(70, 'Обновляю справочники', 'Получаю актуальные значения и роли из TESSA');
    const dictionaryCatalog = await performanceStage(
      'picker.dictionaries',
      () => bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true }),
      { operation: 'picker', rows: snapshot.rows.length },
    );

    APP.bridge = bridge;
    APP.structure = structure;
    APP.snapshot = snapshot;
    APP.dictionaryCatalog = dictionaryCatalog;

    const grid = buildRoundtripGrid(structure, snapshot, {}, dictionaryCatalog);
    setProgress(92, 'Справочники готовы', 'Открываю выбор значений');
    return {
      headers: grid.columns.map(column => column.header),
      schemaTokens: grid.columns.map(column => column.schema),
      dictionaryCatalog: grid.dictionaryCatalog,
    };
  }

  // Excel remains supported when a workbook is explicitly selected. In production, no
  // workbook means a fresh TESSA read every time so Active -> Draft transitions and stale
  // in-memory catalogs cannot make the picker depend on a previous export. Node DOM tests
  // may intentionally inject APP state so they can exercise rendering without a TESSA host.
  async function openValuePicker() {
    const file = document.querySelector('#tms-file')?.files?.[0];
    let source;
    if (file) {
      source = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    } else if (window.__TESSA_MATRIX_SYNC_TEST_MODE__ && APP.structure && APP.snapshot && APP.dictionaryCatalog) {
      const grid = buildRoundtripGrid(APP.structure, APP.snapshot, {}, APP.dictionaryCatalog);
      source = {
        headers: grid.columns.map(column => column.header),
        schemaTokens: grid.columns.map(column => column.schema),
        dictionaryCatalog: grid.dictionaryCatalog,
      };
    } else {
      source = await loadLivePickerSource();
    }
    const columns = pickerColumns(source);`;

  replaceOnce(oldBlock, newBlock, 'Task11 live picker bootstrap');
}

if (!source.includes('createRuntimeMonitor, loadLivePickerSource, pickerColumns,')) {
  replaceOnce(
    'createRuntimeMonitor, pickerColumns,',
    'createRuntimeMonitor, loadLivePickerSource, pickerColumns,',
    'Task11 test export',
  );
}

// Once live loading is supported, an empty catalog must not tell the user to export Excel.
// Keep the workbook-specific guidance only when the user actually selected a workbook.
const oldEmptyCatalogError = "    if (!columns.length) throw new Error('В книге нет справочников для выбора. Скачайте Excel со справочниками.');";
if (source.includes(oldEmptyCatalogError)) {
  replaceOnce(
    oldEmptyCatalogError,
    `    if (!columns.length) throw new Error(file
      ? 'В выбранной книге нет справочников для выбора. Выберите актуальную рабочую книгу.'
      : 'В текущей матрице не удалось получить справочники для выбора. Обновите карточку матрицы и повторите.');`,
    'Task11 no-Excel empty-catalog guidance',
  );
}

// Guard against accidentally weakening unrelated archive protections.
assert.match(source, /MaxInputBytes:\s*32 \* 1024 \* 1024,/);
assert.match(source, /MaxEntries:\s*256,/);
assert.match(source, /MaxEntryUncompressedBytes:\s*128 \* 1024 \* 1024,/);
assert.match(source, /MaxTotalUncompressedBytes:\s*512 \* 1024 \* 1024,/);
assert.match(source, /MaxCompressionRatio:\s*100,/);
assert.match(source, /loadDictionaryCatalog\(structure, snapshot, \{ forceRefresh: true \}\)/);
assert.match(source, /else \{\s*source = await loadLivePickerSource\(\);\s*\}/);
assert.doesNotMatch(source, /Сначала скачайте Excel или выберите рабочую книгу со справочниками\./);
assert.doesNotMatch(source, /В книге нет справочников для выбора\. Скачайте Excel со справочниками\./);

fs.writeFileSync(path, source, 'utf8');
console.log('Task11 patch applied: live picker bootstrap + no-Excel guidance + 512 MiB aggregate XLSX ceiling.');
