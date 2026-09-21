import fs from 'node:fs';

export function applyChangesReportFullRow(input) {
  let source = String(input ?? '');

  if (source.includes('REVIEWED_CHANGES_REPORT_V3')) {
    if (source.includes('Детали изменений')) throw new Error('v3 changes report unexpectedly contains obsolete second sheet');
    if (source.includes("['xl/worksheets/sheet2.xml', sheet2]")) throw new Error('v3 changes report unexpectedly contains obsolete sheet2 package entry');
    return source;
  }

  const v2Start = source.indexOf('  // REVIEWED_CHANGES_REPORT_V2');
  const v1Start = source.indexOf('  // REVIEWED_CHANGES_REPORT_V1');
  const modelStart = v2Start >= 0 ? v2Start : v1Start;
  const modelEnd = source.indexOf('  function changesReportStylesXml()', modelStart);
  if (modelStart < 0 || modelEnd < 0 || modelEnd <= modelStart) {
    throw new Error('changes report model boundaries not found');
  }

  const modelBlock = `  // REVIEWED_CHANGES_REPORT_V3
  // REVIEWED_CHANGES_REPORT_V2
  // Human-facing Russian report. UPDATE shows changed fields only; ADD and DELETE
  // expand the complete populated business row. Technical action names and the mostly
  // empty standalone "reason" column are intentionally excluded from the workbook.
  function buildChangesReportModel(plan, structure = null) {
    const definitionLabels = new Map();
    const businessFieldOrder = [];
    for (const condition of structure?.conditions || []) {
      const key = \`criterion:\${condition.criterionRowId}\`;
      definitionLabels.set(key, condition.criterionName || condition.criterionRowId);
      businessFieldOrder.push(key);
    }
    for (const fn of structure?.functions || []) {
      const key = \`function:\${fn.id}\`;
      definitionLabels.set(key, fn.name || fn.id);
      businessFieldOrder.push(key);
    }

    const headers = ['Действие', 'Строка Excel', 'Строка TESSA', 'Поле', 'Было', 'Стало'];
    const detailHeaders = [...headers];
    const operations = [];
    const details = [];
    const stringifyValues = values => Array.isArray(values)
      ? values.map(value => String(value ?? '').trim()).filter(Boolean).join(' · ')
      : String(values ?? '').trim();
    const actionLabel = type => ({ update: 'Изменена', add: 'Добавлена', delete: 'Удалена' }[type] || String(type || ''));
    const displayValue = values => stringifyValues(values) || '—';
    const fieldLabel = key => definitionLabels.get(key) || key || '';
    const businessEntries = flat => {
      const sourceFlat = flat && typeof flat === 'object' ? flat : {};
      const known = businessFieldOrder.filter(key => Object.prototype.hasOwnProperty.call(sourceFlat, key));
      const extra = Object.keys(sourceFlat)
        .filter(key => /^(criterion|function):/.test(key) && !known.includes(key))
        .sort((a, b) => a.localeCompare(b, 'ru'));
      return [...known, ...extra]
        .map(key => ({ key, label: fieldLabel(key), values: sourceFlat[key] }))
        .filter(item => stringifyValues(item.values));
    };

    for (const action of plan?.actions || []) {
      if (!['update', 'add', 'delete'].includes(action?.type)) continue;
      const change = actionLabel(action.type);
      const excelRow = action.excelRow?.excelRow ?? '';
      const tessaRow = action.currentRow?.index !== undefined ? Number(action.currentRow.index) + 1 : '';
      let fieldRows = [];

      if (action.type === 'update') {
        fieldRows = (Array.isArray(action.changes) ? action.changes : []).map(item => ({
          key: item.key,
          label: item.label || fieldLabel(item.key),
          before: displayValue(item.before),
          after: displayValue(item.after),
        }));
      } else if (action.type === 'add') {
        fieldRows = businessEntries(action.excelRow?.flat).map(item => ({
          key: item.key, label: item.label, before: '—', after: displayValue(item.values),
        }));
      } else {
        fieldRows = businessEntries(action.currentRow?.flat).map(item => ({
          key: item.key, label: item.label, before: displayValue(item.values), after: '—',
        }));
      }

      // Defensive fallback for legacy/synthetic plans that carry changes but not flat.
      if (!fieldRows.length) {
        fieldRows = (Array.isArray(action.changes) ? action.changes : []).map(item => ({
          key: item.key,
          label: item.label || fieldLabel(item.key),
          before: action.type === 'add' ? '—' : displayValue(item.before),
          after: action.type === 'delete' ? '—' : displayValue(item.after),
        }));
      }

      for (const item of fieldRows) {
        details.push({
          change, excelRow, tessaRow, field: item.label || item.key || '',
          before: item.before, after: item.after, error: false,
        });
      }
      if (!fieldRows.length) details.push({ change, excelRow, tessaRow, field: '', before: '—', after: '—', error: false });

      const fields = fieldRows.map(item => item.label || item.key || '').filter(Boolean);
      const beforeParts = fieldRows.map(item => item.label ? \`\${item.label}: \${item.before}\` : item.before);
      const afterParts = fieldRows.map(item => item.label ? \`\${item.label}: \${item.after}\` : item.after);
      operations.push({
        change, excelRow, tessaRow,
        fields: fields.join(' · '), before: beforeParts.join('\\n'), after: afterParts.join('\\n'),
        error: false,
      });
    }

    for (const skip of plan?.skippedRows || []) {
      const reason = normalizeSpace(skip?.reason || 'Строка пропущена.');
      const excelRow = skip?.excelRow ?? '';
      const tessaRow = skip?.tessaRow ?? '';
      const error = Boolean(normalizeSpace(skip?.code || ''));
      operations.push({
        change: 'Пропущена', excelRow, tessaRow,
        fields: 'Причина пропуска', before: '—', after: reason, error,
      });
      details.push({
        change: 'Пропущена', excelRow, tessaRow,
        field: 'Причина пропуска', before: '—', after: reason, error,
      });
    }

    for (const field of plan?.skippedFields || []) {
      const reason = normalizeSpace(field?.reason || 'Поле оставлено без изменения.');
      const excelRow = field?.excelRow ?? '';
      const label = normalizeSpace(field?.label || field?.key || 'Поле');
      operations.push({
        change: 'Пропущено поле', excelRow, tessaRow: '',
        fields: label, before: '—', after: reason, error: true,
      });
      details.push({
        change: 'Пропущено поле', excelRow, tessaRow: '',
        field: label, before: '—', after: reason, error: true,
      });
    }

    for (const value of plan?.skippedValues || []) {
      const reason = normalizeSpace(value?.reason || 'Значение пропущено при проверке.');
      const excelRow = value?.excelRow ?? '';
      const label = normalizeSpace(value?.label || value?.key || 'Поле');
      const rejected = normalizeSpace(value?.value || '') || '—';
      operations.push({
        change: 'Пропущено значение', excelRow, tessaRow: '',
        fields: label, before: rejected, after: reason, error: true,
      });
      details.push({
        change: 'Пропущено значение', excelRow, tessaRow: '',
        field: label, before: rejected, after: reason, error: true,
      });
    }

    return {
      format: 'TESSA_MATRIX_CHANGES_REPORT_V3', reportOnly: true,
      matrixId: plan?.matrixId || '', templateId: plan?.templateId || structure?.templateId || '',
      createdAt: nowIso(), headers, detailHeaders, operations, details,
    };
  }

`;
  source = source.slice(0, modelStart) + modelBlock + source.slice(modelEnd);

  const rowStyleStart = source.indexOf('  function changesReportRowStyle(row) {');
  const worksheetStart = source.indexOf('  function changesReportWorksheetXml(headers, rows, metadata = null) {', rowStyleStart);
  if (rowStyleStart < 0 || worksheetStart < 0 || worksheetStart <= rowStyleStart) {
    throw new Error('changes report row-style boundaries not found');
  }
  const rowStyleBlock = `  function changesReportRowStyle(row) {
    if (row?.change === 'Добавлена') return 4;
    if (row?.change === 'Изменена') return 3;
    if (row?.change === 'Удалена') return 5;
    if (String(row?.change || '').startsWith('Пропущ')) return row?.error ? 7 : 6;
    return 1;
  }

`;
  source = source.slice(0, rowStyleStart) + rowStyleBlock + source.slice(worksheetStart);

  const worksheetBlockStart = source.indexOf('  function changesReportWorksheetXml(headers, rows, metadata = null) {');
  const worksheetBlockEnd = source.indexOf('  async function createChangesReportXlsxBytes(plan, structure = null) {', worksheetBlockStart);
  if (worksheetBlockStart < 0 || worksheetBlockEnd < 0 || worksheetBlockEnd <= worksheetBlockStart) {
    throw new Error('changes report worksheet boundaries not found');
  }
  const worksheetBlock = `  function changesReportWorksheetXml(headers, rows, metadata = null) {
    const sheetRows = [];
    let rowNumber = 1;
    if (metadata) {
      for (const pair of metadata) {
        sheetRows.push(\`<row r="\${rowNumber}" hidden="1">\${xlsxStringCell(rowNumber, 0, pair[0], 1)}\${xlsxStringCell(rowNumber, 1, pair[1], 1)}</row>\`);
        rowNumber += 1;
      }
      rowNumber += 1;
    }
    const headerRow = rowNumber;
    sheetRows.push(\`<row r="\${rowNumber}" ht="34" customHeight="1">\${headers.map((value, index) => xlsxStringCell(rowNumber, index, value, 2)).join("")}</row>\`);
    rowNumber += 1;
    for (const row of rows) {
      const style = changesReportRowStyle(row);
      const values = headers.map(header => ({
        'Действие': row.change,
        'Строка Excel': row.excelRow,
        'Строка TESSA': row.tessaRow,
        'Поле': row.field,
        'Было': row.before,
        'Стало': row.after,
      })[header] ?? '');
      const lines = Math.max(1, ...values.map(value => String(value ?? '').split(/\\r?\\n/).length));
      const height = Math.min(240, Math.max(28, lines * 16 + 8));
      sheetRows.push(\`<row r="\${rowNumber}" ht="\${height}" customHeight="1">\${values.map((value, index) => xlsxStringCell(rowNumber, index, value, style)).join("")}</row>\`);
      rowNumber += 1;
    }
    const lastRow = Math.max(headerRow, rowNumber - 1);
    const lastCol = indexToCol(headers.length - 1);
    const widths = headers.map(header => ({
      'Действие': 16,
      'Строка Excel': 14,
      'Строка TESSA': 14,
      'Поле': 38,
      'Было': 56,
      'Стало': 56,
    })[header] || 30);
    const cols = widths.map((width, index) => \`<col min="\${index + 1}" max="\${index + 1}" width="\${width}" customWidth="1"/>\`).join('');
    return \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:\${lastCol}\${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="\${headerRow}" topLeftCell="A\${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>\${cols}</cols><sheetData>\${sheetRows.join("")}</sheetData><autoFilter ref="A\${headerRow}:\${lastCol}\${lastRow}"/></worksheet>\`;
  }

`;
  source = source.slice(0, worksheetBlockStart) + worksheetBlock + source.slice(worksheetBlockEnd);

  const createStart = source.indexOf('  async function createChangesReportXlsxBytes(plan, structure = null) {');
  const createEnd = source.indexOf('  function sanitizeFileName(value)', createStart);
  if (createStart < 0 || createEnd < 0 || createEnd <= createStart) {
    throw new Error('changes report XLSX boundaries not found');
  }

  const createBlock = `  async function createChangesReportXlsxBytes(plan, structure = null) {
    const model = buildChangesReportModel(plan, structure);
    const metadata = [
      [ROUNDTRIP.ReportOnlyKey, model.format],
      [ROUNDTRIP.MatrixIdKey, model.matrixId],
      [ROUNDTRIP.TemplateIdKey, model.templateId],
      ['__TESSA_CREATED_AT', model.createdAt],
    ];
    const detailRows = model.details.map(row => ({ ...row }));
    const sheet1 = changesReportWorksheetXml(model.detailHeaders, detailRows, metadata);
    const contentTypes = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>\`;
    const rels = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>\`;
    const workbook = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Изменения" sheetId="1" r:id="rId1"/></sheets></workbook>\`;
    const workbookRels = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>\`;
    const created = new Date().toISOString();
    const core = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>TESSA Matrix Studio</dc:creator><dc:title>Отчёт изменений матрицы</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">\${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">\${created}</dcterms:modified></cp:coreProperties>\`;
    const app = \`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Листы</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Изменения</vt:lpstr></vt:vector></TitlesOfParts><Company>ПАО «Группа Черкизово»</Company></Properties>\`;
    return await makeZip([
      ['[Content_Types].xml', contentTypes], ['_rels/.rels', rels], ['docProps/core.xml', core], ['docProps/app.xml', app],
      ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', workbookRels], ['xl/styles.xml', changesReportStylesXml()],
      ['xl/worksheets/sheet1.xml', sheet1],
    ]);
  }

`;
  source = source.slice(0, createStart) + createBlock + source.slice(createEnd);

  if (!source.includes('REVIEWED_CHANGES_REPORT_V3')) throw new Error('changes report V3 marker missing');
  if (source.includes('Детали изменений')) throw new Error('obsolete second changes-report sheet remains');
  if (source.includes("['xl/worksheets/sheet2.xml', sheet2]")) throw new Error('obsolete sheet2 package entry remains');
  return source;
}

const invoked = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (invoked) {
  const target = process.argv[2] || 'tessa-matrix-studio.user.js';
  const input = fs.readFileSync(target, 'utf8');
  const output = applyChangesReportFullRow(input);
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.14.1 changes report: Russian one-sheet full-row report OK');
}
