import fs from 'node:fs';

const file = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(file, 'utf8');

function replaceBetween(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

const pickerUi = `  function pickerColumnView(state, columnIndex = state?.columnIndex || 0) {
    if (!state) return { query: '', roleType: 'all', page: 1, pageSize: 60 };
    state.views = state.views || new Map();
    if (!state.views.has(columnIndex)) {
      const column = state.columns?.[columnIndex];
      state.views.set(columnIndex, {
        query: '',
        roleType: pickerDefaultRoleFilter(column),
        page: 1,
        pageSize: 60,
      });
    }
    return state.views.get(columnIndex);
  }

  function renderPickerResults() {
    const state = APP.picker;
    const host = document.querySelector('#tms-value-picker');
    if (!state || !host) return;
    const column = state.columns[state.columnIndex];
    const view = pickerColumnView(state);
    const queryInput = host.querySelector('#tms-picker-query');
    if (queryInput && queryInput.value !== view.query) queryInput.value = view.query;

    const roleOptions = pickerRoleTypeOptions(column);
    const roleWrap = host.querySelector('#tms-picker-role-type-wrap');
    const roleSelect = host.querySelector('#tms-picker-role-type');
    if (roleWrap && roleSelect) {
      roleWrap.hidden = roleOptions.length === 0;
      roleSelect.innerHTML = roleOptions.map(item => \`<option value="\${escapeHtml(item.value)}">\${escapeHtml(item.label)}</option>\`).join('');
      if (roleOptions.length) {
        if (!roleOptions.some(item => item.value === view.roleType)) view.roleType = pickerDefaultRoleFilter(column);
        roleSelect.value = view.roleType;
      }
    }

    const found = searchPickerPage(column.catalog, {
      query: view.query,
      roleType: roleOptions.length ? view.roleType : 'all',
      page: view.page,
      pageSize: view.pageSize,
    });
    view.page = found.page;
    state.visibleItems = found.items;
    state.lastSearch = found;

    const results = host.querySelector('#tms-picker-results');
    results.innerHTML = found.items.map((item, i) => {
      const presentation = pickerEntryPresentation(item);
      const meta = presentation.subtitle ? \`<small class="tms-picker-option-meta">\${escapeHtml(presentation.subtitle)}</small>\` : '';
      return \`<label class="tms-picker-option"><input type="checkbox" data-picker-index="\${i}" \${state.selected.has(pickerEntryKey(item)) ? 'checked' : ''}><span class="tms-picker-option-copy"><span class="tms-picker-option-title">\${escapeHtml(presentation.title)}</span>\${meta}</span></label>\`;
    }).join('') || '<p class="tms-muted">Ничего не найдено. Измените поиск или тип роли.</p>';

    const shown = found.total ? \`\${found.start}–\${found.end}\` : '0';
    host.querySelector('#tms-picker-count').textContent = \`Найдено: \${found.total} · показано: \${shown} · выбрано: \${state.selected.size}\`;
    host.querySelector('#tms-picker-page-status').textContent = \`Страница \${found.page} / \${found.pageCount}\`;
    const prev = host.querySelector('#tms-picker-prev');
    const next = host.querySelector('#tms-picker-next');
    if (prev) prev.disabled = found.page <= 1;
    if (next) next.disabled = found.page >= found.pageCount;
    const selectPage = host.querySelector('#tms-picker-select-page');
    const selectAll = host.querySelector('#tms-picker-select-all');
    if (selectPage) selectPage.disabled = found.items.length === 0;
    if (selectAll) selectAll.disabled = found.total === 0;

    host.querySelector('#tms-picker-selected').innerHTML = [...state.selected.values()].map((item, i) => {
      const presentation = pickerEntryPresentation(item);
      return \`<button type="button" data-picker-remove="\${i}" aria-label="Убрать \${escapeHtml(presentation.title)}">\${escapeHtml(presentation.title)} ×</button>\`;
    }).join('');

    const output = host.querySelector('#tms-picker-output');
    const copy = host.querySelector('#tms-picker-copy');
    try {
      output.value = pickerSelectionText([...state.selected.values()]);
      copy.disabled = !output.value;
      host.querySelector('#tms-picker-message').textContent = '';
    } catch (error) {
      output.value = '';
      copy.disabled = true;
      host.querySelector('#tms-picker-message').textContent = error.message;
    }
  }

  // Only read a local workbook or the already downloaded dictionary. This picker
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
    const columns = pickerColumns(source);
    if (!columns.length) throw new Error('В книге нет справочников для выбора. Скачайте Excel со справочниками.');
    closeValuePicker();
    APP.picker = {
      columns,
      columnIndex: 0,
      selected: new Map(),
      selections: new Map(),
      views: new Map(),
      visibleItems: [],
      lastSearch: null,
      searchTimer: null,
    };
    const host = document.querySelector('#tms-value-picker');
    host.hidden = false;
    document.querySelector('#tms-open-picker')?.setAttribute('aria-expanded', 'true');
    host.innerHTML = \`<div class="tms-picker-head"><b>Собрать значения для одной ячейки</b><button type="button" id="tms-picker-close" aria-label="Закрыть выбор значений">×</button></div>
      <label for="tms-picker-column">Поле Excel</label><select id="tms-picker-column">\${columns.map((c, i) => \`<option value="\${i}">\${escapeHtml(c.label)}</option>\`).join('')}</select>
      <div id="tms-picker-role-type-wrap" class="tms-picker-filter"><label for="tms-picker-role-type">Тип роли</label><select id="tms-picker-role-type"></select></div>
      <p class="tms-muted">Ищите по названию, ФИО, должности или подразделению. Выбор сохраняется при поиске, фильтрации и переходе между страницами.</p>
      <details><summary>Продолжить набор из ячейки Excel</summary><textarea id="tms-picker-paste" rows="2" aria-label="Значения из Excel"></textarea><button id="tms-picker-import" type="button">Добавить в набор</button></details>
      <input id="tms-picker-query" type="search" aria-label="Поиск по справочнику" placeholder="Например: Иванов, инженер, отдел" maxlength="200">
      <div id="tms-picker-count" class="tms-muted" aria-live="polite"></div>
      <div class="tms-picker-bulk"><button type="button" id="tms-picker-select-page">Выбрать страницу</button><button type="button" id="tms-picker-select-all">Выбрать всё найденное</button></div>
      <div id="tms-picker-results" class="tms-picker-results"></div>
      <div class="tms-picker-pager"><button type="button" id="tms-picker-prev" aria-label="Предыдущая страница">← Назад</button><span id="tms-picker-page-status" class="tms-muted"></span><button type="button" id="tms-picker-next" aria-label="Следующая страница">Вперёд →</button></div>
      <div id="tms-picker-selected" class="tms-picker-selected"></div><label for="tms-picker-output">Готовое содержимое ячейки</label><textarea id="tms-picker-output" readonly rows="3"></textarea>
      <p class="tms-muted">Скопируйте набор. В Excel нажмите F2 в нужной ячейке и вставьте: все значения останутся внутри неё.</p>
      <div class="tms-row"><button type="button" id="tms-picker-copy" class="tms-primary" disabled>Скопировать</button><button type="button" id="tms-picker-clear">Очистить выбор</button></div><div id="tms-picker-message" role="status" aria-live="polite"></div>\`;

    host.onchange = event => {
      const state = APP.picker;
      if (!state || APP.busy) return;
      if (event.target.id === 'tms-picker-column') {
        state.selections.set(state.columnIndex, state.selected);
        state.columnIndex = Number(event.target.value);
        state.selected = state.selections.get(state.columnIndex) || new Map();
        const view = pickerColumnView(state);
        host.querySelector('#tms-picker-query').value = view.query;
      } else if (event.target.id === 'tms-picker-role-type') {
        const view = pickerColumnView(state);
        view.roleType = event.target.value || 'all';
        view.page = 1;
      } else if (event.target.dataset.pickerIndex !== undefined) {
        const item = state.visibleItems[Number(event.target.dataset.pickerIndex)];
        if (!item) return;
        if (event.target.checked) state.selected.set(pickerEntryKey(item), item);
        else state.selected.delete(pickerEntryKey(item));
      } else return;
      renderPickerResults();
    };

    host.oninput = event => {
      if (event.target.id !== 'tms-picker-query' || !APP.picker) return;
      const view = pickerColumnView(APP.picker);
      view.query = event.target.value;
      view.page = 1;
      clearTimeout(APP.picker.searchTimer);
      APP.picker.searchTimer = setTimeout(renderPickerResults, 120);
    };

    host.onclick = async event => {
      const button = event.target.closest('button');
      const state = APP.picker;
      if (!button || !state || APP.busy) return;
      const view = pickerColumnView(state);
      const message = () => host.querySelector('#tms-picker-message');

      if (button.id === 'tms-picker-close') {
        closeValuePicker();
        document.querySelector('#tms-open-picker')?.focus();
        return;
      }
      if (button.id === 'tms-picker-prev' || button.id === 'tms-picker-next') {
        const direction = button.id === 'tms-picker-prev' ? -1 : 1;
        view.page = Math.max(1, view.page + direction);
        renderPickerResults();
        return;
      }
      if (button.id === 'tms-picker-select-page') {
        const bulk = bulkSelectPickerItems(state.selected, state.visibleItems);
        state.selected = bulk.selected;
        renderPickerResults();
        message().textContent = bulk.capacityReached
          ? \`Добавлено \${bulk.added}. Достигнут лимит одной ячейки Excel; остальные значения не выбраны.\`
          : \`Добавлено со страницы: \${bulk.added}. Всего выбрано: \${state.selected.size}.\`;
        return;
      }
      if (button.id === 'tms-picker-select-all') {
        const column = state.columns[state.columnIndex];
        const bulk = bulkSelectPickerMatches(state.selected, column.catalog, {
          query: view.query,
          roleType: pickerRoleTypeOptions(column).length ? view.roleType : 'all',
        });
        state.selected = bulk.selected;
        renderPickerResults();
        message().textContent = bulk.capacityReached
          ? \`Добавлено \${bulk.added}. Достигнут лимит одной ячейки Excel; остальные найденные значения не выбраны.\`
          : \`Добавлено найденных значений: \${bulk.added}. Всего выбрано: \${state.selected.size}.\`;
        return;
      }
      if (button.id === 'tms-picker-import') {
        const column = state.columns[state.columnIndex];
        const dictionary = { catalogs: { selected: column.catalog }, columnCatalogIds: { [column.key]: 'selected' } };
        const unknown = [];
        for (const value of splitCell(host.querySelector('#tms-picker-paste').value)) {
          const result = resolveEmbeddedDictionaryValue({ dictionaryCatalog: dictionary }, { key: column.key, kind: column.kind, excelHeader: column.label }, value, '');
          const entry = result.resolved ? column.catalog.entries.find(e => (column.kind === 'function' ? \`\${e.id}|\${e.roleTypeId}\` : String(e.id)) === result.explicit) : null;
          if (entry) state.selected.set(pickerEntryKey(entry), entry);
          else unknown.push(value);
        }
        renderPickerResults();
        if (unknown.length) message().textContent = \`Не найдены или неоднозначны: \${unknown.join('; ')}\`;
        return;
      }
      if (button.id === 'tms-picker-clear') {
        state.selected.clear();
        renderPickerResults();
        return;
      }
      if (button.dataset.pickerRemove !== undefined) {
        const item = [...state.selected.values()][Number(button.dataset.pickerRemove)];
        if (item) state.selected.delete(pickerEntryKey(item));
        renderPickerResults();
        return;
      }
      if (button.id === 'tms-picker-copy') {
        const output = host.querySelector('#tms-picker-output');
        output.focus();
        output.select();
        try {
          await navigator.clipboard.writeText(output.value);
          if (APP.picker === state) message().textContent = 'Скопировано. Вставьте в Excel через F2 → Ctrl+V.';
        } catch (_) {
          if (APP.picker === state) message().textContent = 'Текст выделен. Нажмите Ctrl+C, затем F2 → Ctrl+V в Excel.';
        }
      }
    };

    host.onkeydown = event => {
      if (event.key === 'Escape') {
        closeValuePicker();
        document.querySelector('#tms-open-picker')?.focus();
        return;
      }
      if (event.key === 'Enter' && event.target.id === 'tms-picker-query' && APP.picker) {
        event.preventDefault();
        const view = pickerColumnView(APP.picker);
        view.query = event.target.value;
        view.page = 1;
        clearTimeout(APP.picker.searchTimer);
        renderPickerResults();
        if (APP.picker.lastSearch?.total === 1) {
          const item = APP.picker.visibleItems[0];
          if (item) APP.picker.selected.set(pickerEntryKey(item), item);
          renderPickerResults();
        } else host.querySelector('#tms-picker-results input')?.focus();
      }
    };

    renderPickerResults();
    host.querySelector('#tms-picker-query').focus();
  }
`;

replaceBetween(
  '  function renderPickerResults() {',
  '\n\n  function mountUi() {',
  pickerUi,
  'replace picker DOM implementation',
);

const cssAnchor = `      #tms-panel .tms-picker-option:hover{background:var(--tms-soft)}\n      #tms-panel .tms-picker-selected{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto}`;
const cssReplacement = `      #tms-panel .tms-picker-option:hover{background:var(--tms-soft)}\n      #tms-panel .tms-picker-filter{display:grid;grid-template-columns:minmax(120px,.45fr) minmax(0,1fr);gap:8px;align-items:center}\n      #tms-panel .tms-picker-bulk,#tms-panel .tms-picker-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n      #tms-panel .tms-picker-pager{justify-content:space-between}\n      #tms-panel .tms-picker-option-copy{display:grid;gap:2px;min-width:0}\n      #tms-panel .tms-picker-option-title{font-weight:600;overflow-wrap:anywhere}\n      #tms-panel .tms-picker-option-meta{font-size:11px;line-height:1.4;color:var(--tms-muted);overflow-wrap:anywhere}\n      #tms-panel .tms-picker-selected{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto}`;
if (!source.includes(cssAnchor)) throw new Error('picker CSS anchor not found');
source = source.replace(cssAnchor, cssReplacement);

fs.writeFileSync(file, source);

const packageFile = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const command = 'node tests/picker-dom-production.cjs';
if (!pkg.scripts.test.includes(command)) pkg.scripts.test += ` && ${command}`;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('production picker DOM patch applied');
