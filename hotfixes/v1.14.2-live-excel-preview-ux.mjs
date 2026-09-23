import fs from 'node:fs';

const replaceFunction = (source, signature, replacement) => {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${signature} boundary not found`);
  const next = source.indexOf('\n  function ', start + signature.length);
  if (next < 0) throw new Error(`${signature} end boundary not found`);
  return source.slice(0, start) + replacement + source.slice(next + 1);
};

export function applyLiveExcelPreviewUx(input) {
  let source = String(input ?? '');
  if (source.includes('LIVE_EXCEL_PREVIEW_UX_V1')) return source;

  source = replaceFunction(source, '  function employeeResolvableAliases(item) {', `  // LIVE_EXCEL_PREVIEW_UX_V1
  // LIVE_PICKER_DELIMITER_SAFE_V2
  // Some MtxRoles installations do not expose a clean ShortName. The native caption can
  // already contain "ФИО - должность; должность". Semicolon is also the Excel multi-value
  // delimiter, so extract a clean employee identity before assembling the copyable alias.
  function employeeSafeNameForPicker(item, rawValue = '') {
    const candidates = [
      item?.shortName,
      item?.nativeDisplay,
      item?.display,
      item?.fullName,
      pickerDetailValue(item, ['RoleFullName', 'UserFullName']),
      rawValue,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeSpace(candidate || '');
      if (!normalized) continue;
      const beforeRole = normalizeSpace(normalized.split(/\\s+-\\s+/)[0] || normalized);
      const beforeList = normalizeSpace(beforeRole.split(/\\s*;\\s*/)[0] || beforeRole);
      if (beforeList && !/[;\\r\\n\\t]/.test(beforeList)) return beforeList;
    }
    return '';
  }

  function employeeSafeSelector(item) {
    const raw = String(item?.selector || item?.display || '').trim();
    if (!raw || Number(item?.roleTypeId) !== PERSONAL_ROLE_TYPE_ID) return raw;
    const isSafe = value => Boolean(value) && !/[;\\r\\n\\t]/.test(value) && !/^[=+@-]/.test(value);
    if (isSafe(raw)) return raw;

    const base = employeeSafeNameForPicker(item, raw);
    const positionRaw = normalizeSpace(item?.position || pickerDetailValue(item, ['RolePositionName', 'UserPosition', 'PositionName', 'Position']));
    const position = pickerPrimaryValue(positionRaw);
    const compact = normalizeSpace(base && position ? (base + ' — ' + position) : base);
    if (isSafe(compact)) return compact;

    // Last resort: preserve the personal-role information while replacing Excel
    // list/control delimiters. employeeResolvableAliases indexes the exact same alias.
    const sanitized = normalizeSpace(raw.replace(/[;\\r\\n\\t]+/g, ' · '));
    if (isSafe(sanitized)) return sanitized;
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

`);

  source = replaceFunction(source, '  function pickerSelectionValue(item) {', `  function pickerSelectionValue(item) {
    const raw = String(item?.selector || item?.display || '').trim();
    const value = Number(item?.roleTypeId) === PERSONAL_ROLE_TYPE_ID ? employeeSafeSelector(item) : raw;
    if (/[\\n\\r;\\t]/.test(value)) throw new Error('В названии есть разделитель. Такое значение нельзя собрать автоматически. Выберите его в штатном редакторе TESSA.');
    if (/^[=+@-]/.test(value)) throw new Error('Название начинается со знака формулы. Выберите его в штатном редакторе TESSA.');
    return value;
  }

`);

  source = replaceFunction(source, '  function pickerEntryPresentation(item) {', `  function pickerEntryPresentation(item) {
    const value = String(item?.selector || item?.display || '').trim();
    const roleType = canonicalValue(item?.roleTypeId);
    const display = normalizeSpace(item?.display);
    const roleFullName = pickerDetailValue(item, ['RoleFullName', 'UserFullName']);
    const positionRaw = normalizeSpace(item?.position || pickerDetailValue(item, ['RolePositionName', 'UserPosition', 'PositionName', 'Position']));
    const position = pickerPrimaryValue(positionRaw);
    const department = pickerCompactList(pickerDetailValue(item, ['Departments', 'UserDepartment', 'Department', 'Info']));
    const isPerson = roleType === '1' || Boolean(roleFullName);
    const personName = isPerson ? employeeSafeNameForPicker(item, value) : '';
    const titleBase = isPerson
      ? (personName || display || roleFullName || normalizeSpace(item?.qualifier) || value)
      : (display || normalizeSpace(item?.qualifier) || value);
    const title = isPerson && position ? (titleBase + ' — ' + position) : titleBase;
    const typeLabel = roleType ? previewRoleTypeLabel(roleType) : '';
    const subtitle = [...new Set([
      isPerson && roleFullName && canonicalValue(roleFullName) !== canonicalValue(titleBase) ? roleFullName : '',
      department,
      typeLabel,
    ].filter(Boolean))].join(' · ');
    return { title, subtitle, typeLabel, value: isPerson ? employeeSafeSelector(item) : value };
  }

`);

  const oldPersonalRoleExport = "values.push(items.map(item => dictionaryRoleDisplay(dict, item) || item.display || dictionarySelector(dict, item.id, item.roleTypeId, '')).join('\\n'));";
  const newPersonalRoleExport = "values.push(items.map(item => Number(item.roleTypeId) === PERSONAL_ROLE_TYPE_ID ? employeeSafeSelector((dictionaryLookup(dict)?.byId?.get(canonicalValue(item.id) + '|' + canonicalValue(item.roleTypeId)) || [])[0] || item) : (dictionaryRoleDisplay(dict, item) || item.display || dictionarySelector(dict, item.id, item.roleTypeId, ''))).join('\\n'));";
  if (source.includes(oldPersonalRoleExport)) source = source.replace(oldPersonalRoleExport, newPersonalRoleExport);
  else if (!source.includes(newPersonalRoleExport)) throw new Error('Function-role Excel export anchor not found');

  const resolutionSignature = '  function renderResolutionCenter(plan) {';
  const resolutionStart = source.indexOf(resolutionSignature);
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
    const effectiveReview = review || createPlanReviewState();
    const reviewed = buildReviewedPlan(plan, effectiveReview);
    const notApplied = Number(reviewed?.counts?.skip || reviewed?.skippedRows?.length || 0);
    const errors = selectPreviewItems(plan, effectiveReview, { filter: 'error', pageSize: 1 }).total;
    const resolutionItems = collectPlanResolutionItems(plan);
    const resolutionRows = new Set(resolutionItems.map(item => Number(item?.excelRow)).filter(Number.isFinite)).size;
    return {
      notApplied,
      errors,
      resolutionValues: resolutionItems.length,
      resolutionRows,
      notAppliedLabel: \`Не будет применено к TESSA: \${notApplied}\`,
      resolutionLabel: resolutionItems.length
        ? \`Требуют уточнения: \${resolutionItems.length} значений\${resolutionRows ? \` в \${resolutionRows} строках\` : ''}\`
        : 'Уточнений не требуется',
    };
  }

`;
  source = source.slice(0, resolutionStart) + helpers + source.slice(resolutionStart);

  source = replaceFunction(source, resolutionSignature, `  function renderResolutionCenter(plan) {
    const host = document.querySelector?.('#tms-resolution-center');
    if (!host) return;
    const items = collectPlanResolutionItems(plan);
    if (!items.length) {
      host.hidden = true;
      host.innerHTML = '';
      if (host.dataset) delete host.dataset.resolutionPage;
      return;
    }
    host.hidden = false;
    const requestedPage = Math.max(0, Number(host.dataset?.resolutionPage || 0));
    const windowed = resolutionCenterWindow(items, requestedPage, 50);
    if (host.dataset) host.dataset.resolutionPage = String(windowed.page - 1);
    const resolutionRows = new Set(items.map(item => Number(item?.excelRow)).filter(Number.isFinite)).size;
    const rangeStart = windowed.total ? windowed.start + 1 : 0;
    const rangeEnd = windowed.start + windowed.items.length;
    const pager = windowed.pageCount > 1
      ? '<div class="tms-preview-pager"><button type="button" data-resolution-page="' + Math.max(0, windowed.page - 2) + '" ' + (windowed.page <= 1 ? 'disabled' : '') + '>←</button><span>Показано ' + rangeStart + '–' + rangeEnd + ' из ' + windowed.total + ' · стр. ' + windowed.page + '/' + windowed.pageCount + '</span><button type="button" data-resolution-page="' + Math.min(windowed.pageCount - 1, windowed.page) + '" ' + (windowed.page >= windowed.pageCount ? 'disabled' : '') + '>→</button></div>'
      : '';
    host.innerHTML = '<div class="tms-review-note"><b>Требуют уточнения: ' + items.length + ' значений' + (resolutionRows ? ' в ' + resolutionRows + ' строках' : '') + '</b><br>Эти значения не будут применены автоматически. Studio не угадывает сотрудника или справочник — выберите точное значение и перепроверьте Preview.</div>'
      + pager
      + windowed.items.map((item, localIndex) => {
        const itemIndex = windowed.start + localIndex;
        const title = item.excelRow ? 'Excel ' + item.excelRow + ' · ' + (item.column || item.columnKey || 'поле') : (item.column || item.columnKey || 'Конфликт');
        const candidates = (item.candidates || []).map((candidate, candidateIndex) => {
          const label = candidate.selector || candidate.display || candidate.shortName || candidate.fullName || candidate.id || 'Вариант';
          return '<div class="tms-resolution-choice"><span>' + escapeHtml(label) + '</span><button type="button" data-resolution-choice="' + itemIndex + ':' + candidateIndex + '">Выбрать и перепроверить</button></div>';
        }).join('');
        return '<details class="tms-action"><summary><b>' + escapeHtml(title) + '</b></summary><div class="tms-action-body"><div class="tms-warning">' + escapeHtml(item.issue || 'Требуется явный выбор.') + '</div>' + candidates + '<button type="button" data-resolution-skip="' + itemIndex + '">Пропустить осознанно</button></div></details>';
      }).join('')
      + pager;

    host.querySelectorAll?.('button[data-resolution-page]')?.forEach(button => button.addEventListener('click', () => {
      if (APP.busy) return;
      if (host.dataset) host.dataset.resolutionPage = String(Math.max(0, Number(button.dataset.resolutionPage) || 0));
      renderResolutionCenter(plan);
    }));

    host.querySelectorAll?.('button[data-resolution-choice]')?.forEach(button => button.addEventListener('click', async () => {
      if (APP.busy) return;
      const [itemIndexText, candidateIndexText] = String(button.dataset.resolutionChoice || '').split(':');
      const item = items[Number(itemIndexText)];
      const candidate = item?.candidates?.[Number(candidateIndexText)];
      if (!item || !candidate) return;
      setBusy(true);
      try {
        const outcome = applyResolutionChoiceToWorkbook(APP.workbook, item, candidate);
        log('Resolution Center: Excel ' + outcome.excelRow + ' → ' + outcome.display + '.');
        await recheckResolutionCenterPlan();
      } catch (error) {
        const message = friendlyErrorMessage(error);
        log(message, 'error', error);
        setProgress(100, 'Не удалось применить уточнение', message);
      } finally {
        setBusy(false);
      }
    }));

    host.querySelectorAll?.('button[data-resolution-skip]')?.forEach(button => button.addEventListener('click', () => {
      const item = items[Number(button.dataset.resolutionSkip)];
      if (!item) return;
      button.disabled = true;
      button.textContent = 'Пропуск подтверждён';
      log('Resolution Center: пользователь осознанно пропустил Excel ' + (item.excelRow || '?') + ' · ' + (item.column || item.columnKey || 'поле') + '.', 'warn');
    }));
  }

`);

  const attentionNeedle = "    const c = reviewed.counts;\n    const skipped = reviewed.skippedRows || [];";
  if (!source.includes(attentionNeedle)) throw new Error('Preview count block not found');
  source = source.replace(attentionNeedle, "    const c = reviewed.counts;\n    const attention = previewAttentionSummary(plan, APP.review);\n    const skipped = reviewed.skippedRows || [];");

  const oldCounters = `        <span class="tms-count tms-noop">без изменений <b>\${c.noop}</b></span>
        <span class="tms-count tms-skip">пропустить <b>\${c.skip || 0}</b></span>`;
  const newCounters = `        <span class="tms-count tms-noop">без изменений <b>\${c.noop}</b></span>
        <span class="tms-count tms-skip">не будет применено <b>\${attention.notApplied}</b></span>
        <span class="tms-count tms-error">из них ошибки <b>\${attention.errors}</b></span>`;
  if (!source.includes(oldCounters)) throw new Error('Preview counters block not found');
  source = source.replace(oldCounters, newCounters);

  const oldSkipNote = '}</b> Пропущено строк: ${skipped.length}. Причины указаны в списке ниже.</div>` : \'\'}';
  const newSkipNote = '}</b> Не будет применено к TESSA: ${skipped.length} строк. Эти строки не записываются; причины указаны в списке ниже.</div>` : \'\'}';
  if (!source.includes(oldSkipNote)) throw new Error('Preview skipped-row explanation not found');
  source = source.replace(oldSkipNote, newSkipNote);

  const oldFilters = "        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}${filterButton('error', 'Ошибки')}";
  const newFilters = "        ${filterButton('all', 'Все')}${filterButton('update', `Изменить ${c.update}`)}${filterButton('add', `Добавить ${c.add}`)}${filterButton('delete', `Удалить ${c.delete}`)}${filterButton('skip', `Не будет применено ${attention.notApplied}`)}${filterButton('error', `Ошибки ${attention.errors}`)}";
  if (!source.includes(oldFilters)) throw new Error('Preview filter block not found');
  source = source.replace(oldFilters, newFilters);

  const cssNeedle = '#tms-panel .tms-counters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));';
  if (!source.includes(cssNeedle)) throw new Error('Preview counter CSS not found');
  source = source.replace(cssNeedle, '#tms-panel .tms-counters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));');

  const exportNeedle = '    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage,';
  if (!source.includes(exportNeedle)) throw new Error('test export block not found');
  source = source.replace(exportNeedle, '    createPlanReviewState, previewAttentionSummary, resolutionCenterWindow, invalidatePlanStateAfterApply, keepReviewedPackage,');

  const uatNeedle = "      await runCheck('action-file-ingest', 'Действие: загрузить изменённый Excel', async () => {";
  if (!source.includes(uatNeedle)) throw new Error('Full UAT insertion point not found');
  const uatChecks = `      await runCheck('live-colleague-picker-multi-position', 'Регрессия: сотрудник с несколькими должностями копируется в Excel', async () => {
        const item = {
          id: 'uat-multi-position', roleTypeId: 1,
          shortName: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии', fullName: '',
          position: 'Руководитель направления; Эксперт по методологии',
          display: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии — Руководитель направления',
          selector: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии — Руководитель направления',
        };
        const text = pickerSelectionText([item]);
        if (!text || /[;\\r\\n\\t]/.test(text)) throw new Error('Picker не сформировал безопасное одиночное значение сотрудника.');
        return { detail: 'Multi-position employee остаётся копируемым одним значением Excel.', data: { outcome: 'picker-selection', valueLength: text.length } };
      });
      await runCheck('live-colleague-preview-attention', 'Регрессия: крупный Preview показывает понятные счётчики и ограничивает список уточнений', async () => {
        const syntheticSkips = Array.from({ length: 196 }, (_, index) => ({ excelRow: index + 15, code: index < 12 ? 'invalid-value' : '', reason: 'synthetic' }));
        const syntheticPlan = { actions: [], counts: { update: 0, add: 0, delete: 0, noop: 100, skip: 196 }, skippedRows: syntheticSkips, desired: [], safety: { blocked: false, blockedReasons: [] } };
        const summary = previewAttentionSummary(syntheticPlan, createPlanReviewState());
        const windowed = resolutionCenterWindow(Array.from({ length: 747 }, (_, index) => ({ excelRow: 15 + (index % 196) })), 0, 50);
        if (summary.notApplied !== 196 || summary.errors !== 12) throw new Error('Preview attention counters do not match the synthetic 196/12 case.');
        if (windowed.items.length !== 50 || windowed.total !== 747 || windowed.hidden !== 697) throw new Error('Resolution Center is not bounded to 50 visible items.');
        return { detail: '196 not-applied rows and 12 errors are explicit; 747-item Resolution Center renders only 50 per page.', data: { outcome: 'preview-plan', notApplied: summary.notApplied, errors: summary.errors, totalClarifications: windowed.total, visibleClarifications: windowed.items.length } };
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
