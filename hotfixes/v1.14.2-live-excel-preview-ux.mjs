import fs from 'node:fs';

const nextTopLevelFunction = (source, start) => {
  const next = source.indexOf('\n  function ', start + 12);
  if (next < 0) throw new Error('next top-level function boundary not found');
  return next + 1;
};

export function applyLiveExcelPreviewUx(input) {
  let source = String(input ?? '');
  if (source.includes('LIVE_EXCEL_PREVIEW_UX_V1')) return source;

  const aliasesStart = source.indexOf('  function employeeResolvableAliases(item) {');
  if (aliasesStart < 0) throw new Error('employeeResolvableAliases boundary not found');
  const aliasesEnd = nextTopLevelFunction(source, aliasesStart);
  const aliasesBlock = `  // LIVE_EXCEL_PREVIEW_UX_V1
  // A person may carry several TESSA positions separated by semicolons. Semicolon is
  // also an Excel multi-value delimiter, so the picker must copy a compact, resolvable
  // single-value alias instead of disabling Copy or splitting one employee into values.
  function employeeSafeSelector(item) {
    const raw = String(item?.selector || item?.display || '').trim();
    if (!raw || Number(item?.roleTypeId) !== PERSONAL_ROLE_TYPE_ID) return raw;
    if (!/[;\\r\\n\\t]/.test(raw)) return raw;
    const presentation = pickerEntryPresentation(item);
    const compact = normalizeSpace(presentation?.title || '');
    if (compact && !/[;\\r\\n\\t]/.test(compact)) return compact;
    const fullName = normalizeSpace(item?.fullName || pickerDetailValue(item, ['RoleFullName', 'UserFullName']));
    if (fullName && !/[;\\r\\n\\t]/.test(fullName)) return fullName;
    return raw;
  }

  function employeeResolvableAliases(item) {
    if (!item || Number(item.roleTypeId) !== PERSONAL_ROLE_TYPE_ID) return [];
    return [...new Set([
      item.displayName, item.shortName, item.fullName, item.nativeDisplay,
      employeeSafeSelector(item),
      ...(item.previousSelectors || []),
    ].map(normalizeSpace).filter(Boolean))];
  }

`;
  source = source.slice(0, aliasesStart) + aliasesBlock + source.slice(aliasesEnd);

  const pickerStart = source.indexOf('  function pickerSelectionValue(item) {');
  if (pickerStart < 0) throw new Error('pickerSelectionValue boundary not found');
  const pickerEnd = nextTopLevelFunction(source, pickerStart);
  const pickerBlock = `  function pickerSelectionValue(item) {
    const raw = String(item?.selector || item?.display || '').trim();
    const value = Number(item?.roleTypeId) === PERSONAL_ROLE_TYPE_ID ? employeeSafeSelector(item) : raw;
    if (/[\\n\\r;\\t]/.test(value)) throw new Error('В названии есть разделитель. Такое значение нельзя собрать автоматически. Выберите его в штатном редакторе TESSA.');
    if (/^[=+@-]/.test(value)) throw new Error('Название начинается со знака формулы. Выберите его в штатном редакторе TESSA.');
    return value;
  }

`;
  source = source.slice(0, pickerStart) + pickerBlock + source.slice(pickerEnd);

  const resolutionStart = source.indexOf('  function renderResolutionCenter(plan) {');
  if (resolutionStart < 0) throw new Error('renderResolutionCenter boundary not found');
  const helpers = `  function resolutionCenterWindow(items, page = 0, pageSize = 50) {
    const all = Array.isArray(items) ? items : [];
    const size = Math.max(1, Math.min(100, Number(pageSize) || 50));
    const pageCount = Math.max(1, Math.ceil(all.length / size));
    const safePage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
    const start = safePage * size;
    const visible = all.slice(start, start + size);
    return { items: visible, total: all.length, hidden: Math.max(0, all.length - visible.length), page: safePage + 1, pageCount, pageSize: size, start };
  }

  function previewAttentionSummary(plan, review = APP.review) {
    const reviewed = buildReviewedPlan(plan, review || createPlanReviewState());
    const notApplied = Number(reviewed?.counts?.skip || reviewed?.skippedRows?.length || 0);
    const errors = selectPreviewItems(plan, review || createPlanReviewState(), { filter: 'error', pageSize: 1 }).total;
    const resolutionItems = collectPlanResolutionItems(plan);
    const resolutionRows = new Set(resolutionItems.map(item => Number(item?.excelRow)).filter(Number.isFinite)).size;
    return {
      notApplied,
      errors,
      resolutionValues: resolutionItems.length,
      resolutionRows,
      notAppliedLabel: notApplied ? \`Не будет применено к TESSA: \${notApplied}\` : 'Не будет применено к TESSA: 0',
      resolutionLabel: resolutionItems.length
        ? \`Требуют уточнения: \${resolutionItems.length} значений\${resolutionRows ? \` в \${resolutionRows} строках\` : ''}\`
        : 'Уточнений не требуется',
    };
  }

`;
  source = source.slice(0, resolutionStart) + helpers + source.slice(resolutionStart);

  const oldResolutionHeader = "    host.hidden = false;\n    host.innerHTML = '<div class=\\\"tms-review-note\\\"><b>Нужно уточнить значения: ' + items.length + '</b><br>Studio не будет угадывать сотрудника или справочник. Выберите точное значение и перепроверьте Preview.</div>'\n      + items.map((item, itemIndex) => {";
  const newResolutionHeader = "    host.hidden = false;\n    const resolutionWindow = resolutionCenterWindow(items, 0, 50);\n    const resolutionRows = new Set(items.map(item => Number(item?.excelRow)).filter(Number.isFinite)).size;\n    host.innerHTML = '<div class=\\\"tms-review-note\\\"><b>Требуют уточнения: ' + items.length + ' значений' + (resolutionRows ? ' в ' + resolutionRows + ' строках' : '') + '</b><br>Эти значения не будут применены автоматически. Studio не угадывает сотрудника или справочник. Показаны первые ' + resolutionWindow.items.length + (resolutionWindow.hidden ? ' из ' + resolutionWindow.total + '; после уточнения Preview пересоберётся и покажет следующие.' : '.') + '</div>'\n      + resolutionWindow.items.map((item, itemIndex) => {";
  if (!source.includes(oldResolutionHeader)) throw new Error('resolution center header block not found');
  source = source.replace(oldResolutionHeader, newResolutionHeader);
  source = source.replace("return '<details class=\\\"tms-action\\\" open><summary><b>' + escapeHtml(title) + '</b></summary>", "return '<details class=\\\"tms-action\\\"><summary><b>' + escapeHtml(title) + '</b></summary>");

  const attentionNeedle = "    const c = reviewed.counts;\n    const skipped = reviewed.skippedRows || [];";
  if (!source.includes(attentionNeedle)) throw new Error('Preview count block not found');
  source = source.replace(attentionNeedle, "    const c = reviewed.counts;\n    const attention = previewAttentionSummary(plan, APP.review);\n    const skipped = reviewed.skippedRows || [];");

  const oldCounters = `        <span class=\"tms-count tms-noop\">без изменений <b>\${c.noop}</b></span>
        <span class=\"tms-count tms-skip\">пропустить <b>\${c.skip || 0}</b></span>`;
  const newCounters = `        <span class=\"tms-count tms-noop\">без изменений <b>\${c.noop}</b></span>
        <span class=\"tms-count tms-skip\">не будет применено <b>\${attention.notApplied}</b></span>
        <span class=\"tms-count tms-error\">из них ошибки <b>\${attention.errors}</b></span>`;
  if (!source.includes(oldCounters)) throw new Error('Preview counters block not found');
  source = source.replace(oldCounters, newCounters);

  const oldFilters = "        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}${filterButton('error', 'Ошибки')}";
  const newFilters = "        ${filterButton('all', 'Все')}${filterButton('update', `Изменить ${c.update}`)}${filterButton('add', `Добавить ${c.add}`)}${filterButton('delete', `Удалить ${c.delete}`)}${filterButton('skip', `Не будет применено ${attention.notApplied}`)}${filterButton('error', `Ошибки ${attention.errors}`)}";
  if (!source.includes(oldFilters)) throw new Error('Preview filter block not found');
  source = source.replace(oldFilters, newFilters);

  source = source.replace('#tms-panel .tms-counters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));', '#tms-panel .tms-counters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));');

  source = source.replace('} Пропущено строк: ${skipped.length}. Причины указаны в списке ниже.</div>` : \'\'}', '} Не будет применено к TESSA: ${skipped.length} строк. Эти строки не записываются; причины указаны в списке ниже.</div>` : \'\'}');

  const exportNeedle = '    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage,';
  if (!source.includes(exportNeedle)) throw new Error('test export block not found');
  source = source.replace(exportNeedle, '    createPlanReviewState, previewAttentionSummary, resolutionCenterWindow, invalidatePlanStateAfterApply, keepReviewedPackage,');

  const uatNeedle = "      await runCheck('action-file-ingest', 'Действие: загрузить изменённый Excel', async () => {";
  if (!source.includes(uatNeedle)) throw new Error('Full UAT insertion point not found');
  const uatChecks = `      await runCheck('live-colleague-picker-multi-position', 'Регрессия: сотрудник с несколькими должностями копируется в Excel', async () => {
        const item = {
          id: 'uat-multi-position', roleTypeId: 1,
          shortName: 'Горинова Т.А.', fullName: 'Горинова Татьяна Александровна',
          position: 'Руководитель направления; Эксперт по методологии',
          display: 'Горинова Т.А. — Руководитель направления; Эксперт по методологии',
          selector: 'Горинова Т.А. — Руководитель направления; Эксперт по методологии',
        };
        const text = pickerSelectionText([item]);
        if (!text || /[;\\r\\n\\t]/.test(text)) throw new Error('Picker не сформировал безопасное одиночное значение сотрудника.');
        return { detail: 'Multi-position employee остаётся копируемым одним значением Excel.', data: { outcome: 'picker-selection', valueLength: text.length } };
      });
      await runCheck('live-colleague-preview-attention', 'Регрессия: крупный Preview показывает понятные счётчики и ограничивает список уточнений', async () => {
        const syntheticSkips = Array.from({ length: 196 }, (_, index) => ({ excelRow: index + 15, code: index < 12 ? 'invalid-value' : '', reason: 'synthetic' }));
        const syntheticPlan = { actions: [], counts: { update: 0, add: 0, delete: 0, noop: 100, skip: 196 }, skippedRows: syntheticSkips, skippedFields: [], safety: { blocked: false, blockedReasons: [] } };
        const summary = previewAttentionSummary(syntheticPlan, createPlanReviewState());
        const windowed = resolutionCenterWindow(Array.from({ length: 747 }, (_, index) => ({ excelRow: 15 + (index % 196) })), 0, 50);
        if (summary.notApplied !== 196 || summary.errors !== 12) throw new Error('Preview attention counters do not match the synthetic 196/12 case.');
        if (windowed.items.length !== 50 || windowed.total !== 747 || windowed.hidden !== 697) throw new Error('Resolution Center is not bounded to 50 visible items.');
        return { detail: '196 not-applied rows and 12 errors are explicit; 747-item Resolution Center renders only first 50.', data: { outcome: 'preview-plan', notApplied: summary.notApplied, errors: summary.errors, totalClarifications: windowed.total, visibleClarifications: windowed.items.length } };
      });
`;
  source = source.replace(uatNeedle, uatChecks + uatNeedle);

  return source;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node hotfixes/v1.14.2-live-excel-preview-ux.mjs <userscript>');
  const input = fs.readFileSync(file, 'utf8');
  const output = applyLiveExcelPreviewUx(input);
  fs.writeFileSync(file, output);
}
