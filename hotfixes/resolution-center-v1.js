  // RESOLUTION_CENTER_V1
  function collectPlanResolutionItems(plan) {
    const collected = [];
    const append = (item, defaults = {}) => {
      if (!item || typeof item !== 'object') return;
      const normalized = {
        ...clonePlain(item),
        source: item.source || defaults.source || 'excel-validation',
        actionType: item.actionType || defaults.actionType || null,
        excelRow: Number(item.excelRow || defaults.excelRow) || null,
        base: item.base ?? null,
        mine: item.mine ?? item.visible ?? '',
        server: item.server ?? null,
        candidates: Array.isArray(item.candidates) ? clonePlain(item.candidates) : [],
      };
      normalized.id = normalizeSpace(normalized.id)
        || ['resolution', normalized.excelRow || 'row', normalized.columnKey || normalized.column || 'field', normalized.valueIndex || 0].join('-');
      collected.push(normalized);
    };
    for (const skip of plan?.skippedRows || []) {
      for (const item of skip?.resolutionItems || []) append(item, skip);
    }
    for (const row of plan?.desired || []) {
      for (const item of row?.resolutionItems || []) append(item, { excelRow: row?.excelRow, source: 'excel-validation' });
    }
    const seen = new Set();
    return collected.filter(item => {
      const key = normalizeSpace(item.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function applyResolutionChoiceToWorkbook(workbook, resolution, choice) {
    if (!workbook || !Array.isArray(workbook.rows)) throw new Error('Книга Excel для исправления недоступна.');
    if (!resolution || typeof resolution !== 'object') throw new Error('Не передан вариант исправления.');
    const excelRow = Number(resolution.excelRow);
    const row = workbook.rows.find(item => Number(item?.excelRow) === excelRow);
    if (!row || !Array.isArray(row.values)) throw new Error('Строка Excel для исправления не найдена.');
    const candidates = Array.isArray(resolution.candidates) ? resolution.candidates : [];
    const requestedId = canonicalValue(choice?.id || '');
    const requestedRoleType = canonicalValue(choice?.roleTypeId ?? '');
    const selected = candidates.find(candidate => {
      if (canonicalValue(candidate?.id || '') !== requestedId) return false;
      const candidateRoleType = canonicalValue(candidate?.roleTypeId ?? '');
      return !requestedRoleType || !candidateRoleType || candidateRoleType === requestedRoleType;
    });
    if (!selected) throw new Error('Выбранный вариант отсутствует в актуальном наборе кандидатов.');

    const valueIndex = Math.max(0, Math.trunc(Number(resolution.valueIndex) || 0));
    const writeToken = (cellIndex, value) => {
      const index = Number(cellIndex);
      if (!Number.isInteger(index) || index < 0) return false;
      const parts = splitCell(row.values[index] || '');
      while (parts.length <= valueIndex) parts.push('');
      parts[valueIndex] = normalizeSpace(value);
      row.values[index] = parts.join('; ');
      return true;
    };

    const display = normalizeSpace(selected.selector || selected.display || selected.shortName || selected.fullName || '');
    if (!display) throw new Error('У выбранного кандидата отсутствует отображаемое значение.');
    const explicit = normalizeSpace(selected.explicit || (selected.roleTypeId === undefined || selected.roleTypeId === null || selected.roleTypeId === ''
      ? String(selected.id || '')
      : String(selected.id || '') + '|' + String(selected.roleTypeId)));
    const changedVisible = writeToken(resolution.columnIndex, display);
    const changedExplicit = writeToken(resolution.idIndex, explicit);
    if (!changedVisible) throw new Error('Не удалось определить колонку Excel для исправления.');
    return { changed: changedVisible || changedExplicit, excelRow, display, explicit, candidate: clonePlain(selected) };
  }

  async function recheckResolutionCenterPlan() {
    if (!APP.workbook || !APP.structure || !APP.bridge) throw new Error('Сначала выполните проверку выбранного Excel.');
    APP.abortRequested = false;
    setProgress(20, 'Перепроверяю исправление', 'Перечитываю актуальную матрицу TESSA');
    const bridge = APP.bridge;
    const structure = APP.structure;
    const snapshot = await bridge.loadSnapshot(structure);
    const plan = buildPlan(APP.workbook, structure, snapshot, bridge.matrixInfo());
    plan.safety = evaluatePlanSafety(plan, bridge);
    plan.matrixInfo = plan.safety.matrixInfo;
    let previewPlan = plan;
    if (!plan.safety.blocked && plan.actions.some(action => action.type !== 'noop')) {
      const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure, onProgress: () => {} });
      previewPlan = applyPreflightPreview(plan, previewPreflight);
    }
    APP.snapshot = snapshot;
    setSessionSnapshot(snapshot, structure);
    APP.review = createPlanReviewState();
    APP.previewView = createPreviewViewState();
    APP.plan = previewPlan;
    renderPlan(previewPlan);
    const unresolved = collectPlanResolutionItems(previewPlan).length;
    setProgress(100, unresolved ? 'Нужно ещё уточнение' : 'Исправление проверено', unresolved ? 'Остались неоднозначные значения: ' + unresolved : 'Preview пересобран по актуальной TESSA.');
    return previewPlan;
  }

  function renderResolutionCenter(plan) {
    const host = document.querySelector?.('#tms-resolution-center');
    if (!host) return;
    const items = collectPlanResolutionItems(plan);
    if (!items.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = '<div class="tms-review-note"><b>Нужно уточнить значения: ' + items.length + '</b><br>Studio не будет угадывать сотрудника или справочник. Выберите точное значение и перепроверьте Preview.</div>'
      + items.map((item, itemIndex) => {
        const title = item.excelRow ? 'Excel ' + item.excelRow + ' · ' + (item.column || item.columnKey || 'поле') : (item.column || item.columnKey || 'Конфликт');
        const candidates = (item.candidates || []).map((candidate, candidateIndex) => {
          const label = candidate.selector || candidate.display || candidate.shortName || candidate.fullName || candidate.id || 'Вариант';
          return '<div class="tms-resolution-choice"><span>' + escapeHtml(label) + '</span><button type="button" data-resolution-choice="' + itemIndex + ':' + candidateIndex + '">Выбрать и перепроверить</button></div>';
        }).join('');
        return '<details class="tms-action" open><summary><b>' + escapeHtml(title) + '</b></summary><div class="tms-action-body"><div class="tms-warning">' + escapeHtml(item.issue || 'Требуется явный выбор.') + '</div>' + candidates + '<button type="button" data-resolution-skip="' + itemIndex + '">Пропустить осознанно</button></div></details>';
      }).join('');

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
