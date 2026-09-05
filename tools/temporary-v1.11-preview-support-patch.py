from pathlib import Path

script = Path('tessa-matrix-studio.user.js')
code = script.read_text(encoding='utf-8')


def replace_once(label, before, after):
    global code
    count = code.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    code = code.replace(before, after, 1)


replace_once('preview helpers', '''  function createPreviewViewState(overrides = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(overrides.pageSize) || 40)));
    const page = Math.max(1, Math.trunc(Number(overrides.page) || 1));
    const filter = ['all', 'update', 'add', 'delete', 'skip'].includes(canonicalValue(overrides.filter))
      ? canonicalValue(overrides.filter)
      : 'all';
    return { page, pageSize, filter, query: normalizeSpace(overrides.query || '') };
  }
''', '''  function previewRoleTypeLabel(roleTypeId) {
    const key = canonicalValue(roleTypeId);
    const known = {
      '0': 'Статическая',
      '1': 'Сотрудник',
      '2': 'Подразделение',
      '3': 'Динамическая',
      '4': 'Контекстная',
      '5': 'Метароль',
      '6': 'Задача',
      '7': 'SmartRole',
    };
    return known[key] || `RoleTypeID: ${String(roleTypeId ?? '').trim() || '—'}`;
  }

  function previewPackedRoleTypeId(value) {
    const text = String(value ?? '');
    const separator = text.lastIndexOf('|');
    if (separator < 0 || separator === text.length - 1) return '';
    return text.slice(separator + 1).trim();
  }

  function previewIdsForKey(row, key) {
    if (Array.isArray(row?.ids?.[key])) return row.ids[key];
    if (!String(key || '').startsWith('function:')) return [];
    const functionId = String(key).slice('function:'.length);
    return (row?.roles?.[functionId] || []).map(item => `${item?.id ?? ''}|${item?.roleTypeId ?? ''}`);
  }

  function isPreviewErrorSkip(skip) {
    return Boolean(normalizeSpace(skip?.code || ''));
  }

  function createPreviewViewState(overrides = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(overrides.pageSize) || 40)));
    const page = Math.max(1, Math.trunc(Number(overrides.page) || 1));
    const filter = ['all', 'update', 'add', 'delete', 'skip', 'error'].includes(canonicalValue(overrides.filter))
      ? canonicalValue(overrides.filter)
      : 'all';
    return { page, pageSize, filter, query: normalizeSpace(overrides.query || '') };
  }
''')

replace_once('preview selection error filter', '''    if (state.filter !== 'skip') {
      items = (plan?.actions || [])
        .filter(action => action?.type && action.type !== 'noop')
        .filter(action => state.filter === 'all' || action.type === state.filter)
        .map(action => ({ kind: 'action', action }));
    }
    // "All" includes rejected rows, too. Keep actions first to preserve review
    // ordering; these display-only items never enter the executable Apply plan.
    if (state.filter === 'all' || state.filter === 'skip') {
      items = items.concat((plan?.skippedRows || []).map(skip => ({ kind: 'skip', skip })));
    }
''', '''    if (!['skip', 'error'].includes(state.filter)) {
      items = (plan?.actions || [])
        .filter(action => action?.type && action.type !== 'noop')
        .filter(action => state.filter === 'all' || action.type === state.filter)
        .map(action => ({ kind: 'action', action }));
    }
    // "All" includes rejected rows, too. SKIP is the full rejected-row set;
    // ERROR is the stricter subset with a stable machine-readable code.
    if (state.filter === 'all' || state.filter === 'skip' || state.filter === 'error') {
      const skipped = state.filter === 'error'
        ? (plan?.skippedRows || []).filter(isPreviewErrorSkip)
        : (plan?.skippedRows || []);
      items = items.concat(skipped.map(skip => ({ kind: 'skip', skip })));
    }
''')

replace_once('support report builder insertion', '''  function jsonReplacer(key, value) {
''', '''  function buildPreviewSupportReport(plan, review = null, options = {}) {
    const reviewed = buildReviewedPlan(plan, review);
    const availability = applyAvailability(plan, review);
    const reasonCodes = [...new Set([
      ...(reviewed?.skippedRows || []).map(item => normalizeSpace(item?.code || '')).filter(Boolean),
      ...(reviewed?.skippedFields || []).map(item => normalizeSpace(item?.code || '')).filter(Boolean),
    ])].sort();
    const roleTypeIds = new Set();
    const collectRow = row => {
      for (const values of Object.values(row?.ids || {})) {
        for (const packed of values || []) {
          const typeId = previewPackedRoleTypeId(packed);
          if (typeId) roleTypeIds.add(typeId);
        }
      }
      for (const values of Object.values(row?.roles || {})) {
        for (const item of values || []) {
          const typeId = normalizeSpace(item?.roleTypeId ?? '');
          if (typeId) roleTypeIds.add(typeId);
        }
      }
    };
    for (const action of reviewed?.actions || []) {
      collectRow(action?.excelRow);
      collectRow(action?.currentRow);
    }
    return {
      format: 'TESSA_MATRIX_SUPPORT_REPORT_V1',
      studioVersion: APP.version,
      createdAt: nowIso(),
      ...(options.includeIds ? {
        matrixId: plan?.matrixId || null,
        templateId: plan?.templateId || null,
      } : {}),
      counts: {
        update: Number(reviewed?.counts?.update || 0),
        add: Number(reviewed?.counts?.add || 0),
        delete: Number(reviewed?.counts?.delete || 0),
        noop: Number(reviewed?.counts?.noop || 0),
        skip: Number(reviewed?.counts?.skip || 0),
        skippedFields: Number(reviewed?.skippedFields?.length || 0),
      },
      reasonCodes,
      roleTypeIds: [...roleTypeIds].sort(),
      sources: [...new Set((reviewed?.skippedRows || []).map(item => normalizeSpace(item?.source || '')).filter(Boolean))].sort(),
      apply: {
        canApply: Boolean(availability.canApply),
        count: Number(availability.count || 0),
        blocked: Boolean(availability.blocked),
        batchBlocked: Boolean(availability.batchBlocked),
      },
    };
  }

  function jsonReplacer(key, value) {
''')

replace_once('filter toolbar', '''        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}
''', '''        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}${filterButton('error', 'Ошибки')}
''')

replace_once('update role preview', '''<div class="tms-diff-values"><div class="tms-before"><small>Было</small>${previewValuesHtml(change.before, plan.columnMap, change.key)}</div><div class="tms-after"><small>Будет</small>${previewValuesHtml(change.after, plan.columnMap, change.key)}</div></div>
''', '''<div class="tms-diff-values"><div class="tms-before"><small>Было</small>${previewValuesHtml(change.before, plan.columnMap, change.key, previewIdsForKey(action.currentRow, change.key))}</div><div class="tms-after"><small>Будет</small>${previewValuesHtml(change.after, plan.columnMap, change.key, previewIdsForKey(action.excelRow, change.key))}</div></div>
''')

replace_once('add delete role preview', '''      } else if (action.type === 'add') body.innerHTML = `${rowReviewControl}${flatToHtml(action.excelRow.flat, plan.columnMap)}`;
      else body.innerHTML = `${rowReviewControl}${flatToHtml(action.currentRow.flat, plan.columnMap)}`;
''', '''      } else if (action.type === 'add') body.innerHTML = `${rowReviewControl}${flatToHtml(action.excelRow.flat, plan.columnMap, action.excelRow)}`;
      else body.innerHTML = `${rowReviewControl}${flatToHtml(action.currentRow.flat, plan.columnMap, action.currentRow)}`;
''')

replace_once('preview render helpers', '''  function previewValuesHtml(values, columnMap, key) {
    if (!values?.length) return 'Не заполнено';
    const column = columnMap?.columns?.get?.(String(key).slice(String(key).indexOf(':') + 1));
    const isBoolean = column?.key === key && operandKind(column) === 'Boolean';
    return values.map(value => `<span class="tms-value">${escapeHtml(isBoolean ? booleanDisplay(value) : value)}</span>`).join('');
  }

  function flatToHtml(flat, columnMap = null) {
    const labels = new Map([...(columnMap?.columns?.values?.() || [])].map(column => [column.key, column.excelHeader || column.name]));
    return Object.entries(flat).filter(([, value]) => value?.length).map(([key, value]) => `<div><b>${escapeHtml(labels.get(key) || key)}</b>: ${previewValuesHtml(value, columnMap, key)}</div>`).join('') || 'Пустая строка';
  }
''', '''  function previewValuesHtml(values, columnMap, key, ids = []) {
    if (!values?.length) return 'Не заполнено';
    const column = columnMap?.columns?.get?.(String(key).slice(String(key).indexOf(':') + 1));
    const isBoolean = column?.key === key && operandKind(column) === 'Boolean';
    const isRole = column?.key === key && column?.kind === 'function';
    return values.map((value, index) => {
      const typeId = isRole ? previewPackedRoleTypeId(ids?.[index]) : '';
      const typeBadge = typeId ? `<small class="tms-role-type">${escapeHtml(previewRoleTypeLabel(typeId))}</small>` : '';
      return `<span class="tms-value">${escapeHtml(isBoolean ? booleanDisplay(value) : value)}${typeBadge}</span>`;
    }).join('');
  }

  function flatToHtml(flat, columnMap = null, row = null) {
    const labels = new Map([...(columnMap?.columns?.values?.() || [])].map(column => [column.key, column.excelHeader || column.name]));
    return Object.entries(flat).filter(([, value]) => value?.length).map(([key, value]) => `<div><b>${escapeHtml(labels.get(key) || key)}</b>: ${previewValuesHtml(value, columnMap, key, previewIdsForKey(row, key))}</div>`).join('') || 'Пустая строка';
  }
''')

replace_once('role badge css', '''      #tms-panel .tms-value{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
''', '''      #tms-panel .tms-value{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
      #tms-panel .tms-role-type{display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid var(--tms-line);border-radius:999px;background:var(--tms-bg);color:var(--tms-muted);font-size:10px;line-height:1.4;vertical-align:middle;white-space:nowrap}
''')

replace_once('support report button', '''<button id="tms-analyze" class="tms-primary" disabled>Проверить изменения</button><button id="tms-download-report" hidden disabled>Скачать результат</button><button id="tms-stop" hidden disabled>Отмена</button>''', '''<button id="tms-analyze" class="tms-primary" disabled>Проверить изменения</button><button id="tms-download-report" hidden disabled>Скачать результат</button><button id="tms-download-support-report" hidden disabled>Отчёт для поддержки</button><button id="tms-stop" hidden disabled>Отмена</button>''')

replace_once('support button activation', '''    rememberReport(buildPreviewReport(plan, APP.review),
      `TESSA_Matrix_Preview_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
''', '''    const supportReportButton = document.querySelector('#tms-download-support-report');
    if (supportReportButton) {
      supportReportButton.hidden = false;
      setControlDisabled(supportReportButton, false);
    }
    rememberReport(buildPreviewReport(plan, APP.review),
      `TESSA_Matrix_Preview_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
''')

replace_once('support report handler', '''    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });
''', '''    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });
    panel.querySelector('#tms-download-support-report').addEventListener('click', () => {
      if (APP.busy || !APP.plan) return;
      downloadJson(buildPreviewSupportReport(APP.plan, APP.review),
        `TESSA_Matrix_Support_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, null);
    });
''')

replace_once('exports', '''    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,
''', '''    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems, previewRoleTypeLabel, buildPreviewSupportReport,
''')

script.write_text(code, encoding='utf-8')

package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
needle = 'node tests/preview-only-skips.mjs && node tests/review-all-action-types.mjs'
replacement = 'node tests/preview-only-skips.mjs && node tests/preview-support-ux.mjs && node tests/review-all-action-types.mjs'
if package_text.count(needle) != 1:
    raise RuntimeError('package test insertion point not found uniquely')
package.write_text(package_text.replace(needle, replacement, 1), encoding='utf-8')

code_map = Path('docs/CODE-MAP.md')
doc = code_map.read_text(encoding='utf-8')
if '## Preview support UX (1.11.0)' not in doc:
    doc += '''\n\n## Preview support UX (1.11.0)\n\nPreview остаётся presentation-only: `selectPreviewItems` фильтрует отображение, но не состав Apply. Фильтр «Ошибки» показывает только пропущенные строки со стабильным `code`; «Пропустить» сохраняет полный набор rejected rows. Для function-полей Preview показывает `RoleTypeID` как человекочитаемый тип для стандартных TESSA 0–7, а неизвестные значения не угадывает (`RoleTypeID: N`).\n\n`buildPreviewSupportReport` формирует privacy-safe отчёт без бизнес-значений, ФИО и row/role IDs: только версия Studio, счётчики, reason codes, источники пропусков, встреченные RoleTypeID и доступность Apply. Matrix/Template ID включаются только явной опцией. Полный Preview JSON остаётся отдельным ручным экспортом.\n'''
    code_map.write_text(doc, encoding='utf-8')

for temp in [
    Path('.github/workflows/temporary-v1.11-preview-red.yml'),
    Path('.github/workflows/temporary-v1.11-preview-green.yml'),
    Path('tools/temporary-v1.11-preview-support-patch.py'),
]:
    if temp.exists():
        temp.unlink()

print('v1.11 preview support UX patch applied and temporary files removed')
