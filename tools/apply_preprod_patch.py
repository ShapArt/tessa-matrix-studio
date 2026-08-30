from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    "    review: createPlanReviewState(),\n    workbook: null,",
    "    review: createPlanReviewState(),\n    previewView: createPreviewViewState(),\n    workbook: null,",
    'APP preview state',
)

# A new workbook must never inherit page/filter/search state from the previous Preview.
text = text.replace(
    "APP.review = createPlanReviewState();",
    "APP.review = createPlanReviewState();\n    APP.previewView = createPreviewViewState();",
)
if "APP.previewView = createPreviewViewState();" not in text:
    raise SystemExit('review reset hook not found')

helpers = r'''  /**
   * Session-only view state for large Preview. It never changes the plan itself and
   * therefore cannot alter Apply semantics by paging/filtering the DOM.
   */
  function createPreviewViewState(overrides = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(overrides.pageSize) || 40)));
    const page = Math.max(1, Math.trunc(Number(overrides.page) || 1));
    const filter = ['all', 'update', 'add', 'delete', 'skip'].includes(canonicalValue(overrides.filter))
      ? canonicalValue(overrides.filter)
      : 'all';
    return { page, pageSize, filter, query: normalizeSpace(overrides.query || '') };
  }

  function previewActionSearchText(action) {
    const parts = [
      action?.type,
      action?.excelRow?.excelRow,
      action?.currentRow?.index !== undefined ? Number(action.currentRow.index) + 1 : '',
      ...(action?.changes || []).flatMap(change => [change?.label, change?.key, ...(change?.before || []), ...(change?.after || [])]),
      ...Object.values(action?.excelRow?.flat || {}).flat(),
      ...Object.values(action?.currentRow?.flat || {}).flat(),
    ];
    return canonicalValue(parts.filter(value => value !== null && value !== undefined).join(' '));
  }

  /**
   * Selects exactly one Preview page from the full plan. Review state is accepted so
   * callers can share one signature with renderPlan, but paging itself deliberately
   * uses source plan actions: a fully excluded UPDATE must remain reachable to restore.
   */
  function selectPreviewItems(plan, review = null, viewState = null) {
    void review;
    const state = createPreviewViewState(viewState || {});
    const query = canonicalValue(state.query);
    let items;
    if (state.filter === 'skip') {
      items = (plan?.skippedRows || []).map(skip => ({ kind: 'skip', skip }));
      if (query) {
        items = items.filter(item => canonicalValue(`${item.skip?.excelRow || ''} ${item.skip?.reason || ''}`).includes(query));
      }
    } else {
      items = (plan?.actions || [])
        .filter(action => action?.type && action.type !== 'noop')
        .filter(action => state.filter === 'all' || action.type === state.filter)
        .map(action => ({ kind: 'action', action }));
      if (query) items = items.filter(item => previewActionSearchText(item.action).includes(query));
    }

    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    const page = Math.min(state.page, pageCount);
    const offset = (page - 1) * state.pageSize;
    const pageItems = items.slice(offset, offset + state.pageSize);
    return {
      items: pageItems,
      total,
      page,
      pageSize: state.pageSize,
      pageCount,
      start: total ? offset + 1 : 0,
      end: total ? offset + pageItems.length : 0,
      filter: state.filter,
      query: state.query,
    };
  }

'''
replace_once(
    "  function cherkizovoLogoSvg() {",
    helpers + "  function cherkizovoLogoSvg() {",
    'preview helper insertion',
)

old_preview = r'''    // Показываем исходные найденные действия, а не только effective actions: иначе
    // полностью отключённая строка исчезнет из preview и её нельзя будет вернуть.
    const visible = plan.actions.filter(action => action.type !== 'noop');
    const previewLimit = 40;
    const previewActions = visible.slice(0, previewLimit);
    if (!visible.length && !skipped.length) table.innerHTML = '<div class="tms-empty">Изменений нет.</div>';

    previewActions.forEach(action => {'''
new_preview = r'''    // Показываем исходные найденные действия, а не только effective actions: иначе
    // полностью отключённая строка исчезнет из preview и её нельзя будет вернуть.
    APP.previewView = createPreviewViewState(APP.previewView || {});
    const selection = selectPreviewItems(plan, APP.review, APP.previewView);
    APP.previewView.page = selection.page;

    const toolbar = document.createElement('div');
    toolbar.className = 'tms-preview-toolbar';
    const filterButton = (value, label) => `<button type="button" class="tms-preview-filter${selection.filter === value ? ' tms-active' : ''}" data-preview-filter="${value}">${label}</button>`;
    toolbar.innerHTML = `
      <div class="tms-preview-filters">
        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}
      </div>
      <input id="tms-preview-query" class="tms-preview-query" type="search" placeholder="Найти строку или значение" value="${escapeHtml(selection.query)}">
      <div class="tms-preview-pager">
        <button type="button" data-preview-page="${Math.max(1, selection.page - 1)}" ${selection.page <= 1 ? 'disabled' : ''}>←</button>
        <span>Показано ${selection.start}–${selection.end} из ${selection.total} · стр. ${selection.page}/${selection.pageCount}</span>
        <button type="button" data-preview-page="${Math.min(selection.pageCount, selection.page + 1)}" ${selection.page >= selection.pageCount ? 'disabled' : ''}>→</button>
      </div>`;
    table.appendChild(toolbar);

    if (!selection.total) {
      const empty = document.createElement('div');
      empty.className = 'tms-empty';
      empty.textContent = selection.filter === 'skip' ? 'Пропущенных строк по этому фильтру нет.' : 'Изменений по этому фильтру нет.';
      table.appendChild(empty);
    }
    const previewActions = selection.items.filter(item => item.kind === 'action').map(item => item.action);

    previewActions.forEach(action => {'''
replace_once(old_preview, new_preview, 'renderPlan source paging')

old_more = r'''    if (visible.length > previewLimit) {
      const more = document.createElement('div');
      more.className = 'tms-empty';
      more.textContent = `Ещё ${visible.length - previewLimit} изменений не развёрнуты. Счётчики сверху учитывают весь план.`;
      table.appendChild(more);
    }

    // Делегируем клики одной функцией: renderPlan может пересобирать карточки сколько угодно.
    table.onclick = event => {'''
new_more = r'''    selection.items.filter(item => item.kind === 'skip').forEach(({ skip }) => {
      const item = document.createElement('details');
      item.className = 'tms-action tms-action-skip';
      item.innerHTML = `<summary><b>ПРОПУСТИТЬ</b> — ${skip?.excelRow ? `Excel ${escapeHtml(skip.excelRow)}` : 'строка без номера'}</summary><div class="tms-action-body">${escapeHtml(skip?.reason || 'Причина не указана')}</div>`;
      table.appendChild(item);
    });

    // Делегируем навигацию и review-клики: renderPlan может пересобирать карточки сколько угодно.
    table.onclick = event => {
      const filter = event.target?.closest?.('button[data-preview-filter]');
      if (filter && !APP.busy) {
        APP.previewView = createPreviewViewState({ ...APP.previewView, filter: filter.dataset.previewFilter, page: 1 });
        renderPlan(APP.plan);
        return;
      }
      const pager = event.target?.closest?.('button[data-preview-page]');
      if (pager && !pager.disabled && !APP.busy) {
        APP.previewView = createPreviewViewState({ ...APP.previewView, page: Number(pager.dataset.previewPage) || 1 });
        renderPlan(APP.plan);
        return;
      }'''
replace_once(old_more, new_more, 'renderPlan paging controls')

# Add query handler after click delegate and before Apply button update.
old_click_end = r'''      renderPlan(APP.plan);
    };

    const executableCount = reviewed.actions.filter(action => action.type !== 'noop').length;'''
new_click_end = r'''      renderPlan(APP.plan);
    };
    table.oninput = event => {
      if (event.target?.id !== 'tms-preview-query' || APP.busy) return;
      APP.previewView = createPreviewViewState({ ...APP.previewView, query: event.target.value, page: 1 });
      renderPlan(APP.plan);
      requestAnimationFrame(() => {
        const queryInput = document.querySelector('#tms-preview-query');
        if (queryInput) { queryInput.focus(); queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length); }
      });
    };

    const executableCount = reviewed.actions.filter(action => action.type !== 'noop').length;'''
replace_once(old_click_end, new_click_end, 'preview query handler')

old_css = ".tms-before{color:#8a3232}.tms-after{color:#17683a}.tms-empty{padding:15px;text-align:center;color:#777}"
new_css = ".tms-before{color:#8a3232}.tms-after{color:#17683a}.tms-preview-toolbar{display:grid;gap:7px;margin:9px 0 10px;padding:9px;border:1px solid #e8e8e8;border-radius:12px;background:#fafafa}.tms-preview-filters{display:flex;gap:5px;flex-wrap:wrap}.tms-preview-filter,.tms-preview-pager button{border:1px solid #d8d8d8;background:#fff;border-radius:8px;padding:5px 8px;font:600 10px/1.2 Arial,sans-serif;cursor:pointer}.tms-preview-filter.tms-active{border-color:var(--tms-red);color:var(--tms-red-dark);background:#fff4f4}.tms-preview-query{width:100%;box-sizing:border-box;border:1px solid #d8d8d8;border-radius:9px;padding:7px 9px;font:12px Arial,sans-serif}.tms-preview-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#666;font-size:10px}.tms-preview-pager button:disabled{opacity:.35;cursor:not-allowed}.tms-action-skip{border-left:4px solid #7352a1}.tms-empty{padding:15px;text-align:center;color:#777}"
replace_once(old_css, new_css, 'preview styles')

replace_once(
    "    createPlanReviewState, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan,",
    "    createPlanReviewState, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,",
    'test exports',
)

path.write_text(text, encoding='utf-8')
print('Applied large Preview hardening patch')
