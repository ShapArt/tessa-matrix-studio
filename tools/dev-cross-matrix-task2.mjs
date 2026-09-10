import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const buildPlanStart = `  function buildPlan(workbook, structure, snapshot) {
    const columnMap = buildColumnMap(workbook, structure);
    const desired = workbookRowsToDesired(workbook, columnMap);
    const built = columnMap.mode === 'roundtrip'
      ? buildRoundtripPlan(workbook, structure, snapshot, columnMap, desired)
      : buildLegacyPlan(workbook, structure, snapshot, columnMap, desired);
`;
if (!code.includes(buildPlanStart)) throw new Error('buildPlan start marker not found');

const replacementHelpers = `  function foreignDesiredRow(row) {
    return {
      ...row,
      system: {
        ...(row?.system || {}),
        action: 'keep',
        rowCardId: '',
        versionId: '',
        baseFingerprint: '',
      },
    };
  }

  function buildCrossMatrixReplacementPlan(workbook, structure, snapshot, columnMap, desired) {
    const actions = [];
    const issues = [];
    const warnings = [];
    const usedCurrent = new Set();
    const desiredRows = (desired || []).filter(row => row?.hasData).map(foreignDesiredRow);
    const currentBySemanticKey = new Map();
    for (const currentRow of snapshot?.rows || []) {
      const key = duplicateRowKey(currentRow, null, structure);
      if (!currentBySemanticKey.has(key)) currentBySemanticKey.set(key, []);
      currentBySemanticKey.get(key).push(currentRow);
    }

    const desiredBySemanticKey = new Map();
    for (const excelRow of desiredRows) {
      const key = duplicateRowKey(null, excelRow, structure);
      if (!desiredBySemanticKey.has(key)) desiredBySemanticKey.set(key, []);
      desiredBySemanticKey.get(key).push(excelRow);
    }
    const duplicateDesired = [...desiredBySemanticKey.values()].filter(rows => rows.length > 1);
    if (duplicateDesired.length) {
      issues.push(`Перенос заблокирован: в Excel есть ${duplicateDesired.length} групп полностью одинаковых строк. Итоговая матрица должна содержать уникальные строки.`);
      return { actions: [], issues, warnings, skippedRows: [], usedCurrent, desiredRows };
    }

    for (const excelRow of desiredRows) {
      const key = duplicateRowKey(null, excelRow, structure);
      const matches = (currentBySemanticKey.get(key) || []).filter(currentRow => {
        const identity = canonicalValue(currentRow.versionId || currentRow.rowCardId || '');
        return identity && !usedCurrent.has(identity);
      });
      if (matches.length > 1) {
        issues.push(`Перенос заблокирован: текущая матрица содержит несколько семантически одинаковых строк для одной строки Excel. Нельзя выбрать строку для сохранения без догадки.`);
        continue;
      }
      if (matches.length === 1) {
        const currentRow = matches[0];
        const identity = canonicalValue(currentRow.versionId || currentRow.rowCardId || '');
        if (identity) usedCurrent.add(identity);
        actions.push({
          type: 'noop',
          excelRow,
          currentRow,
          changes: [],
          match: { matchedBy: 'cross-matrix-replace-keep', lowConfidence: false },
          expectedFingerprint: currentRow.fingerprint,
        });
        continue;
      }
      actions.push({
        type: 'add',
        excelRow,
        currentRow: null,
        changes: [],
        match: { matchedBy: 'cross-matrix-replace-add', lowConfidence: false },
        expectedFingerprint: null,
      });
    }

    if (issues.length) return { actions: [], issues, warnings, skippedRows: [], usedCurrent, desiredRows };

    for (const currentRow of snapshot?.rows || []) {
      const identity = canonicalValue(currentRow.versionId || currentRow.rowCardId || '');
      if (identity && usedCurrent.has(identity)) continue;
      actions.push({
        type: 'delete',
        excelRow: null,
        currentRow,
        changes: [],
        match: { matchedBy: 'cross-matrix-replace-delete', lowConfidence: false },
        expectedFingerprint: currentRow.fingerprint,
      });
    }
    return { actions, issues, warnings, skippedRows: [], usedCurrent, desiredRows };
  }

  function buildPlan(workbook, structure, snapshot, matrixInfo = null) {
    const columnMap = buildColumnMap(workbook, structure);
    const desired = workbookRowsToDesired(workbook, columnMap);
    const workbookContext = columnMap.mode === 'roundtrip' && matrixInfo
      ? classifyWorkbookContext(workbook, matrixInfo)
      : null;
    const isCrossMatrixReplacement = workbookContext?.kind === 'same-template-foreign-matrix';
    const built = columnMap.mode === 'roundtrip'
      ? (isCrossMatrixReplacement
          ? buildCrossMatrixReplacementPlan(workbook, structure, snapshot, columnMap, desired)
          : buildRoundtripPlan(workbook, structure, snapshot, columnMap, desired))
      : buildLegacyPlan(workbook, structure, snapshot, columnMap, desired);
`;
code = code.replace(buildPlanStart, replacementHelpers);

const warningsNeedle = `    const warnings = [...columnMap.warnings, ...(built.warnings || [])];`;
const warningsReplacement = `    const rawWarnings = [...columnMap.warnings, ...(built.warnings || [])];
    const warnings = isCrossMatrixReplacement
      ? rawWarnings.map(text => String(text).replace(
          'Они сохранят текущие значения; для редактирования нажмите «Обновить Excel-схему».',
          'При переносе для новых строк эти поля останутся пустыми или получат значение TESSA по умолчанию; перед применением они будут проверены.'
        ))
      : rawWarnings;`;
if (!code.includes(warningsNeedle)) throw new Error('warnings marker not found');
code = code.replace(warningsNeedle, warningsReplacement);

const planNeedle = `      counts: countActions(actions, skippedRows),
    };`;
const planReplacement = `      counts: countActions(actions, skippedRows),
      workbookContext,
      crossMatrixReplacement: isCrossMatrixReplacement ? {
        enabled: true,
        sourceMatrixId: workbook?.roundtrip?.matrixId || null,
        targetMatrixId: snapshot?.matrixId || null,
        sourceMatrixName: normalizeSpace(workbook?.metadata?.['Наименование матрицы'] || workbook?.metadata?.['Тип матрицы'] || ''),
        targetMatrixName: normalizeSpace(matrixInfo?.Name || matrixInfo?.TemplateName || ''),
      } : null,
    };`;
if (!code.includes(planNeedle)) throw new Error('plan metadata marker not found');
code = code.replace(planNeedle, planReplacement);

const analyzeNeedle = `    const plan = buildPlan(workbook, structure, snapshot);`;
const analyzeReplacement = `    const plan = buildPlan(workbook, structure, snapshot, bridge.matrixInfo());`;
if (!code.includes(analyzeNeedle)) throw new Error('analyze buildPlan marker not found');
code = code.replace(analyzeNeedle, analyzeReplacement);

const exportNeedle = `    readXlsxArrayBuffer, parseSheetXml, buildColumnMap, workbookRowsToDesired, buildPlan,`;
const exportReplacement = `    readXlsxArrayBuffer, parseSheetXml, buildColumnMap, workbookRowsToDesired, foreignDesiredRow, buildCrossMatrixReplacementPlan, buildPlan,`;
if (!code.includes(exportNeedle)) throw new Error('build exports marker not found');
code = code.replace(exportNeedle, exportReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-context.mjs';
const replacement = `${marker} && node tests/cross-matrix-replace.mjs && node tests/cross-matrix-schema-drift.mjs`;
if (!pkg.scripts.test.includes('node tests/cross-matrix-replace.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('package cross-matrix context test marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, replacement);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 2 replacement planner patch applied');
