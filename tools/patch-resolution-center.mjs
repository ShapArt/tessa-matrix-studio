import fs from 'node:fs';

const path = process.argv[2] || 'tessa-matrix-studio.user.js';
const hotfixPath = process.argv[3] || 'hotfixes/resolution-center-v1.js';
let source = fs.readFileSync(path, 'utf8');
const block = fs.readFileSync(hotfixPath, 'utf8').trimEnd();
const marker = '// RESOLUTION_CENTER_V1';

if (source.includes(marker)) {
  console.log('Resolution Center patch already applied');
  process.exit(0);
}

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Resolution Center patch: ${label} anchor not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Resolution Center patch: ${label} anchor is ambiguous`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

replaceOnce(
  '      const fieldIssues = [];\n      const resolutions = [];',
  '      const fieldIssues = [];\n      const resolutions = [];\n      const resolutionItems = [];',
  'desired-row resolutionItems declaration',
);

replaceOnce(
`          if (result.issue) {
            issues.push(\`Excel \${row.excelRow}: \${result.issue}\`);
            compareValues.push(\`invalid:\${canonicalValue(visible)}\`);
            return;
          }`,
`          if (result.issue) {
            issues.push(\`Excel \${row.excelRow}: \${result.issue}\`);
            if (result.resolution && Array.isArray(result.candidates) && result.candidates.length) {
              resolutionItems.push({
                id: \`excel-\${row.excelRow}-\${column.key}-\${index}\`,
                source: 'excel-validation',
                excelRow: row.excelRow,
                columnKey: column.key,
                column: column.excelHeader,
                columnIndex: column.index,
                idIndex: column.idIndex,
                valueIndex: index,
                base: null,
                mine: visible,
                server: null,
                visible,
                resolution: result.resolution,
                issue: result.issue,
                candidates: clonePlain(result.candidates),
              });
            }
            compareValues.push(\`invalid:\${canonicalValue(visible)}\`);
            return;
          }`,
  'structured resolver issue capture',
);

replaceOnce(
  '      return { excelRow: row.excelRow, flat, ids, compare, columns, system, hasData, clearedForDeletion, issues, fieldIssues, resolutions, fingerprint: fingerprintFlat(flat), compareFingerprint: fingerprintFlat(compare) };',
  '      return { excelRow: row.excelRow, flat, ids, compare, columns, system, hasData, clearedForDeletion, issues, fieldIssues, resolutions, resolutionItems, fingerprint: fingerprintFlat(flat), compareFingerprint: fingerprintFlat(compare) };',
  'desired-row return DTO',
);

replaceOnce(
  '  function finalizeApplyResult(result, options = {}) {',
  `${block}\n\n  function finalizeApplyResult(result, options = {}) {`,
  'runtime insertion before finalizeApplyResult',
);

replaceOnce(
`    const mutationIncomplete = result.matrixSaveIncomplete
      || result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    result.status = cancelled ? 'cancelled' : (mutationIncomplete ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';`,
`    const mutationIncomplete = result.matrixSaveIncomplete
      || result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    const sourceNeedsAttention = result.sourceSkippedCount > 0;
    result.status = cancelled
      ? 'cancelled'
      : (mutationIncomplete ? 'partial' : (sourceNeedsAttention ? 'attention' : 'completed'));
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';`,
  'attention final status',
);

replaceOnce(
`    const mutationSkipped = preflightSkipped + storeSkipped;
    if (result?.verificationIncomplete && mutationSkipped === 0 && notStarted === 0 && applied === requested) {`,
`    if (result?.status === 'attention') {
      return \`Требуется внимание.\\
\\
Применено: \${applied} из \${requested}.\\
Отдельно не вошли в Apply: \${sourceSkipped}.\\
\\
Исправьте неоднозначные значения в Resolution Center и перепроверьте Preview либо подтвердите осознанный пропуск. Зелёный результат возможен только без неразрешённых пользовательских изменений.\`;
    }
    const mutationSkipped = preflightSkipped + storeSkipped;
    if (result?.verificationIncomplete && mutationSkipped === 0 && notStarted === 0 && applied === requested) {`,
  'attention result message',
);

replaceOnce(
  '        <div id="tms-summary"></div><div id="tms-plan"></div>',
  '        <div id="tms-summary"></div><section id="tms-resolution-center" hidden aria-label="Разрешение неоднозначностей"></section><div id="tms-plan"></div>',
  'Resolution Center UI host',
);

replaceOnce(
  '    // Не теряем раскрытую строку после клика по review-кнопке и повторного renderPlan().',
  '    renderResolutionCenter(plan);\n\n    // Не теряем раскрытую строку после клика по review-кнопке и повторного renderPlan().',
  'Resolution Center render hook',
);

replaceOnce(
  '    refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,',
  '    refreshNativeMatrixViewAfterApply, collectPlanResolutionItems, applyResolutionChoiceToWorkbook, finalizeApplyResult, applyResultMessage,',
  'test exports',
);

replaceOnce(
  '      #tms-panel .tms-review-state{font-size:12px;color:var(--tms-muted)}',
  '      #tms-panel .tms-review-state{font-size:12px;color:var(--tms-muted)}\n      #tms-panel #tms-resolution-center{margin:12px 0}\n      #tms-panel .tms-resolution-choice{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--tms-line)}\n      #tms-panel .tms-resolution-choice span{flex:1;overflow-wrap:anywhere}',
  'Resolution Center CSS',
);

fs.writeFileSync(path, source, 'utf8');
console.log('Patched Resolution Center + attention result state');
