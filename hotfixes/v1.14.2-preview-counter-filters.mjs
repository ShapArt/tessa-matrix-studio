import fs from 'node:fs';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
};

const replacePatternOnce = (source, pattern, after, label) => {
  let count = 0;
  const output = source.replace(pattern, () => {
    count += 1;
    return after;
  });
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return output;
};

export function applyPreviewCounterFilters(input) {
  let source = String(input ?? '');
  if (source.includes('PREVIEW_COUNTER_FILTERS_V1')) return source;
  if (!source.includes('LIVE_EXCEL_PREVIEW_UX_V1')) {
    throw new Error('Preview counter filters require LIVE_EXCEL_PREVIEW_UX_V1 first');
  }

  source = replaceOnce(
    source,
    '  function renderResolutionCenter(plan) {',
    `  // PREVIEW_COUNTER_FILTERS_V1
  // The summary cards are the single Preview filter surface. Clicking a different card
  // selects that category; clicking the active card again returns to the complete list.
  function previewCounterFilterTarget(currentFilter, requestedFilter) {
    const allowed = ['update', 'add', 'delete', 'skip', 'error'];
    const current = canonicalValue(currentFilter);
    const requested = canonicalValue(requestedFilter);
    if (!allowed.includes(requested)) return ['all', ...allowed].includes(current) ? current : 'all';
    return current === requested ? 'all' : requested;
  }

  function renderResolutionCenter(plan) {`,
    'counter-filter helper insertion',
  );

  const oldCounters = `      <div class=\"tms-counters\">
        <span class=\"tms-count tms-update\">изменить <b>\${c.update}</b></span>
        <span class=\"tms-count tms-add\">добавить <b>\${c.add}</b></span>
        <span class=\"tms-count tms-delete\">удалить <b>\${c.delete}</b></span>
        <span class=\"tms-count tms-noop\">без изменений <b>\${c.noop}</b></span>
        <span class=\"tms-count tms-skip\">не будет применено <b>\${attention.notApplied}</b></span>
        <span class=\"tms-count tms-error\">из них ошибки <b>\${attention.errors}</b></span>
      </div>`;
  const newCounters = `      <div class=\"tms-counters\" aria-label=\"Фильтр Preview по типу изменения\">
        <button type=\"button\" class=\"tms-count tms-count-filter tms-update\${APP.previewView.filter === 'update' ? ' tms-active' : ''}\" data-preview-counter-filter=\"update\" aria-pressed=\"\${APP.previewView.filter === 'update' ? 'true' : 'false'}\">изменить <b>\${c.update}</b></button>
        <button type=\"button\" class=\"tms-count tms-count-filter tms-add\${APP.previewView.filter === 'add' ? ' tms-active' : ''}\" data-preview-counter-filter=\"add\" aria-pressed=\"\${APP.previewView.filter === 'add' ? 'true' : 'false'}\">добавить <b>\${c.add}</b></button>
        <button type=\"button\" class=\"tms-count tms-count-filter tms-delete\${APP.previewView.filter === 'delete' ? ' tms-active' : ''}\" data-preview-counter-filter=\"delete\" aria-pressed=\"\${APP.previewView.filter === 'delete' ? 'true' : 'false'}\">удалить <b>\${c.delete}</b></button>
        <span class=\"tms-count tms-noop\">без изменений <b>\${c.noop}</b></span>
        <button type=\"button\" class=\"tms-count tms-count-filter tms-skip\${APP.previewView.filter === 'skip' ? ' tms-active' : ''}\" data-preview-counter-filter=\"skip\" aria-pressed=\"\${APP.previewView.filter === 'skip' ? 'true' : 'false'}\">не будет применено <b>\${attention.notApplied}</b></button>
        <button type=\"button\" class=\"tms-count tms-count-filter tms-error\${APP.previewView.filter === 'error' ? ' tms-active' : ''}\" data-preview-counter-filter=\"error\" aria-pressed=\"\${APP.previewView.filter === 'error' ? 'true' : 'false'}\">из них ошибки <b>\${attention.errors}</b></button>
      </div>`;
  source = replaceOnce(source, oldCounters, newCounters, 'Preview counter cards');

  // Remove only the rendered duplicate filter row. The tiny local factory may remain
  // dead in the template source; keeping this transform independent of quote escaping
  // makes the release composition resilient across the 1.14.x source variants.
  source = replacePatternOnce(
    source,
    /^      <div class=\\?"tms-preview-filters\\?">\n        \$\{filterButton[^\n]+\}\n      <\/div>\n/gm,
    '',
    'duplicated lower Preview filters',
  );

  const oldClickHandler = `      const filter = event.target?.closest?.('button[data-preview-filter]');
      if (filter && !APP.busy) {
        APP.previewView = createPreviewViewState({ ...APP.previewView, filter: filter.dataset.previewFilter, page: 1 });
        renderPlan(APP.plan);
        return;
      }`;
  const newClickHandler = `      const counterFilter = event.target?.closest?.('button[data-preview-counter-filter]');
      if (counterFilter && !APP.busy) {
        const nextFilter = previewCounterFilterTarget(APP.previewView?.filter, counterFilter.dataset.previewCounterFilter);
        APP.previewView = createPreviewViewState({ ...APP.previewView, filter: nextFilter, page: 1 });
        renderPlan(APP.plan);
        return;
      }`;
  source = replaceOnce(source, oldClickHandler, newClickHandler, 'Preview counter click delegation');

  const cssCount = '      #tms-panel .tms-count{padding:8px 4px;border:1px solid var(--tms-line);border-radius:var(--tms-radius);font-size:11px;text-align:center;background:var(--tms-soft)}\n';
  const cssCounterButtons = `${cssCount}      #tms-panel button.tms-count-filter{min-height:0;font-weight:400;line-height:1.5;width:100%;background:var(--tms-soft);cursor:pointer}\n      #tms-panel button.tms-count-filter:hover:enabled{background:var(--tms-soft);border-color:#9fa7b1}\n      #tms-panel button.tms-count-filter.tms-active{background:var(--tms-bg);border-color:var(--tms-red);box-shadow:inset 0 0 0 1px var(--tms-red)}\n`;
  source = replaceOnce(source, cssCount, cssCounterButtons, 'Preview counter button CSS');
  source = replaceOnce(source, '      #tms-panel .tms-preview-filters{display:flex;gap:4px;flex-wrap:wrap}\n', '', 'legacy Preview filter CSS');
  source = replaceOnce(source, '      #tms-panel .tms-preview-filter.tms-active{border-color:var(--tms-red);color:var(--tms-red-dark)}\n', '', 'legacy Preview active-filter CSS');

  const exportNeedle = '    createPlanReviewState, previewAttentionSummary, resolutionCenterWindow, invalidatePlanStateAfterApply, keepReviewedPackage,';
  const exportReplacement = '    createPlanReviewState, previewAttentionSummary, resolutionCenterWindow, previewCounterFilterTarget, invalidatePlanStateAfterApply, keepReviewedPackage,';
  source = replaceOnce(source, exportNeedle, exportReplacement, 'counter-filter test export');

  const uatNeedle = "      await runCheck('action-file-ingest', 'Действие: загрузить изменённый Excel', async () => {";
  const uatCheck = `      await runCheck('live-colleague-preview-counter-filters', 'Регрессия: верхние счётчики Preview управляют фильтром без дублирующей панели', async () => {
        if (typeof E.previewCounterFilterTarget !== 'function') throw new Error('Full UAT export previewCounterFilterTarget недоступен.');
        const add = E.previewCounterFilterTarget('all', 'add');
        const all = E.previewCounterFilterTarget('add', 'add');
        const errors = E.previewCounterFilterTarget('delete', 'error');
        if (add !== 'add' || all !== 'all' || errors !== 'error') throw new Error('Счётчики Preview переключают фильтры неверно.');
        return { detail: 'Счётчики являются единственным фильтром: выбор категории работает, повторный клик возвращает «Все».', data: { outcome: 'preview-counter-filter', add, all, errors } };
      });
`;
  if (!source.includes(uatNeedle)) throw new Error('Full UAT insertion point not found for counter filters');
  source = source.replace(uatNeedle, uatCheck + uatNeedle);

  return source;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node hotfixes/v1.14.2-preview-counter-filters.mjs <userscript>');
  const input = fs.readFileSync(file, 'utf8');
  const output = applyPreviewCounterFilters(input);
  fs.writeFileSync(file, output);
}
