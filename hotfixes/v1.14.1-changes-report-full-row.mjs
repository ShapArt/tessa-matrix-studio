import fs from 'node:fs';

export function applyChangesReportFullRow(input) {
  let source = String(input ?? '');

  if (source.includes('REVIEWED_CHANGES_REPORT_V2') && !source.includes('REVIEWED_CHANGES_REPORT_V1')) {
    if (source.includes('Детали изменений')) throw new Error('v2 changes report unexpectedly contains obsolete second sheet');
    if (source.includes("['xl/worksheets/sheet2.xml', sheet2]")) throw new Error('v2 changes report unexpectedly contains obsolete sheet2 package entry');
    return source;
  }

  const modelStart = source.indexOf('  // REVIEWED_CHANGES_REPORT_V1');
  const modelEnd = source.indexOf('  function changesReportStylesXml()', modelStart);
  if (modelStart < 0 || modelEnd < 0 || modelEnd <= modelStart) {
    throw new Error('changes report model boundaries not found');
  }

  const modelBlock = `  // REVIEWED_CHANGES_REPORT_V2
  // One self-contained, field-level report: UPDATE shows the changed fields, while ADD
  // and DELETE expand the complete populated business row so reviewers never have to
  // reopen the source workbook just to understand what is being added or removed.
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

    const headers = ['Изменение', 'Excel row', 'Причина', 'TESSA row', 'Поля', 'Было', 'Стало'];
    const detailHeaders = ['Изменение', 'Excel row', 'TESSA row', 'Поле', 'Было', 'Стало', 'Причина'];
    const operations = [];
    const details = [];
    const stringifyValues = values => Array.isArray(values)
      ? values.map(value => String(value ?? '').trim()).filter(Boolean).join(' · ')
      : String(values ?? '').trim();
    const actionLabel = type => ({ update: 'UPDATE', add: 'ADD', delete: 'DELETE' }[type] || String(type || '').toUpperCase());
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
      const reason = normalizeSpace(action.reason || action.match?.reason || '');
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
          before: item.before, after: item.after, reason, error: false,
        });
      }
      if (!fieldRows.length) details.push({ change, excelRow, tessaRow, field: '', before: '—', after: '—', reason, error: false });

      const fields = fieldRows.map(item => item.label || item.key || '').filter(Boolean);
      const beforeParts = fieldRows.map(item => item.label ? \`\${item.label}: \${item.before}\` : item.before);
      const afterParts = fieldRows.map(item => item.label ? \`\${item.label}: \${item.after}\` : item.after);
      operations.push({
        change, excelRow, reason, tessaRow,
        fields: fields.join(' · '), before: beforeParts.join('\\n'), after: afterParts.join('\\n'),
        error: false,
      });
    }

    for (const skip of plan?.skippedRows || []) {
      const reason = normalizeSpace(skip?.reason || 'Строка пропущена.');
      const excelRow = skip?.excelRow ?? '';
      const tessaRow = skip?.tessaRow ?? '';
      const error = Boolean(normalizeSpace(skip?.code || ''));
      operations.push({ change: 'SKIP', excelRow, reason, tessaRow, fields: '', before: '', after: '', error });
      details.push({ change: 'SKIP', excelRow, tessaRow, field: '', before: '—', after: '—', reason, error });
    }

    return {
      format: 'TESSA_MATRIX_CHANGES_REPORT_V2', reportOnly: true,
      matrixId: plan?.matrixId || '', templateId: plan?.templateId || structure?.templateId || '',
      createdAt: nowIso(), headers, detailHeaders, operations, details,
    };
  }

`;
  source = source.slice(0, modelStart) + modelBlock + source.slice(modelEnd);

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

  if (!source.includes('REVIEWED_CHANGES_REPORT_V2')) throw new Error('changes report V2 marker missing');
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
  console.log('TESSA Matrix Studio v1.14.1 changes report: one self-contained full-row sheet OK');
}
