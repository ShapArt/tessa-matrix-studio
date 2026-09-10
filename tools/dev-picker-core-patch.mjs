import fs from 'node:fs';

const file = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(file, 'utf8');
const replaceOnce = (before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  source = source.replace(before, after);
};

replaceOnce(
`  function finalizeDictionaryEntries(entries) {`,
`  function partnerRecordKeepingColumnIndex(columns) {
    // Live Черкизово GchPartners exposes this as IsRecordKeeping (Boolean).
    // Russian captions are accepted for compatible installations, but only by exact
    // normalized field name: never guess from unrelated partner flags.
    const accepted = new Set([
      'isrecordkeeping',
      'ведение делопроизводства',
      'ведение дела производства',
      'ведение дел производства',
    ]);
    return Array.from(columns || []).findIndex(column => accepted.has(searchCanonical(column)));
  }

  function finalizeDictionaryEntries(entries) {`,
'insert partner record-keeping detector');

replaceOnce(
`    if (!catalog) return { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [] } };`,
`    if (!catalog) return { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [], warnings: [] } };`,
'normalize empty catalog warnings');
replaceOnce(
`    catalog.stats.errors = catalog.stats.errors || [];
    NORMALIZED_DICTIONARY_CATALOGS.add(catalog);`,
`    catalog.stats.errors = catalog.stats.errors || [];
    catalog.stats.warnings = catalog.stats.warnings || [];
    NORMALIZED_DICTIONARY_CATALOGS.add(catalog);`,
'normalize catalog warnings');
replaceOnce(
`      stats: { ...(base.stats || {}), errors: [...(base.stats?.errors || [])] },`,
`      stats: { ...(base.stats || {}), errors: [...(base.stats?.errors || [])], warnings: [...(base.stats?.warnings || [])] },`,
'preserve catalog warnings');

replaceOnce(
`      const hiddenIndex = columns.findIndex(alias => /(?:^|Is)Hidden$|Disabled$/i.test(String(alias)));
      const activeIndex = columns.findIndex(alias => /(?:^|Is)Active$/i.test(String(alias)));
      const entries = [];`,
`      const hiddenIndex = columns.findIndex(alias => /(?:^|Is)Hidden$|Disabled$/i.test(String(alias)));
      const activeIndex = columns.findIndex(alias => /(?:^|Is)Active$/i.test(String(alias)));
      const recordKeepingIndex = options.recordKeepingOnly ? partnerRecordKeepingColumnIndex(columns) : -1;
      const entries = [];`,
'extract record-keeping index');
replaceOnce(
`        if (hidden || inactive) continue;
        const roleTypeId = roleTypeIndex >= 0`,
`        if (hidden || inactive) continue;
        if (options.recordKeepingOnly && recordKeepingIndex >= 0 && booleanSemantic(row[recordKeepingIndex]) !== true) continue;
        const roleTypeId = roleTypeIndex >= 0`,
'filter record-keeping rows');

replaceOnce(
`      const catalog = { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [] } };`,
`      const catalog = { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [], warnings: [] } };`,
'load catalog warnings');

replaceOnce(
`            try { projection = this.dictionaryProjection(result, { refSection: group.conditions[0].refSection }); entries = this.extractDictionaryEntries(result, { wantedKind: group.wantedKind, refSection: group.conditions[0].refSection }); sourceCount = entries.length; }
            catch (error) { catalog.stats.errors.push(\`${'${label}'}: ${'${error.message}'}\`); }`,
`            try {
              projection = this.dictionaryProjection(result, { refSection: group.conditions[0].refSection });
              const recordKeepingPartner = canonicalValue(group.alias) === 'gchpartners';
              const recordKeepingIndex = recordKeepingPartner ? partnerRecordKeepingColumnIndex(result.columns) : -1;
              if (recordKeepingPartner && recordKeepingIndex < 0) {
                catalog.stats.warnings.push(\`${'${label}'}: в GchPartners не найден Boolean-флаг IsRecordKeeping (Ведение делопроизводства). Справочник оставлен без фильтра, чтобы не потерять допустимые ЮЛ.\`);
              }
              entries = this.extractDictionaryEntries(result, {
                wantedKind: group.wantedKind,
                refSection: group.conditions[0].refSection,
                recordKeepingOnly: recordKeepingPartner && recordKeepingIndex >= 0,
              });
              sourceCount = entries.length;
            }
            catch (error) { catalog.stats.errors.push(\`${'${label}'}: ${'${error.message}'}\`); }`,
'apply GchPartners record-keeping policy');

replaceOnce(
`      '7': 'SmartRole',
    };`,
`      '7': 'SmartRole',
      '9': 'Группа',
    };`,
'role type group label');

const pickerStart = `  function pickerEntryKey(item) { return \`${'${canonicalValue(item.id)}'}|${'${canonicalValue(item.roleTypeId || \'\')}'}\`; }

  // Reuse the dictionary search index; bound rendered results, keep total count.
  function searchPickerEntries(catalog, query = '', limit = 80) {
    const terms = searchCanonical(query).split(/\\s+/).filter(Boolean);
    const items = []; let total = 0;
    for (const row of dictionaryLookup(catalog)?.searchRows || []) {
      if (!terms.every(term => row.haystack.includes(term))) continue;
      total++;
      if (items.length < Math.max(1, Math.min(200, limit))) items.push(row.item);
    }
    return { items, total };
  }

  // Clipboard payload is plain text for Excel edit mode. Do not silently split
  // a selector containing delimiters or allow a pasted formula prefix.
  function pickerSelectionText(items) {
    const unique = [...new Map(items.map(item => [pickerEntryKey(item), item])).values()];
    const values = unique.map(item => String(item.selector || item.display || '').trim());
    if (values.some(value => /[\\n\\r;\\t]/.test(value))) throw new Error('В названии есть разделитель. Такое значение нельзя собрать автоматически. Выберите его в штатном редакторе TESSA.');
    if (values.some(value => /^[=+@-]/.test(value))) throw new Error('Название начинается со знака формулы. Выберите его в штатном редакторе TESSA.');
    const result = values.join('\\n');
    if (result.length > 32767) throw new Error('В ячейке Excel может быть не больше 32767 символов. Уменьшите выбор.');
    return result;
  }`;

const pickerCore = `  function pickerEntryKey(item) { return \`${'${canonicalValue(item.id)}'}|${'${canonicalValue(item.roleTypeId ?? \'\')}'}\`; }

  function pickerRoleTypeOptions(column) {
    if (column?.kind !== 'function') return [];
    const present = new Set((column.catalog?.entries || []).map(item => canonicalValue(item.roleTypeId)).filter(Boolean));
    if (!present.size) return [];
    const preferred = ['1', '2', '0', '4', '5', '9', '3', '6', '7'];
    const ordered = [...preferred.filter(id => present.has(id)), ...[...present].filter(id => !preferred.includes(id)).sort()];
    return [{ value: 'all', label: 'Все типы' }, ...ordered.map(value => ({ value, label: previewRoleTypeLabel(value) }))];
  }

  function pickerDefaultRoleFilter(column) {
    const options = pickerRoleTypeOptions(column);
    return options.some(item => item.value === '1') ? '1' : 'all';
  }

  function pickerSearchMatch(row, terms, roleType) {
    if (roleType && roleType !== 'all' && canonicalValue(row?.item?.roleTypeId) !== canonicalValue(roleType)) return false;
    return terms.every(term => row.haystack.includes(term));
  }

  // Pagination is computed over the in-memory search index. Only one bounded page is
  // returned to the DOM; changing a page never discards the selection Map.
  function searchPickerPage(catalog, options = {}) {
    const query = options?.query ?? '';
    const terms = searchCanonical(query).split(/\\s+/).filter(Boolean);
    const roleType = canonicalValue(options?.roleType || 'all') || 'all';
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(options?.pageSize) || 80)));
    const requestedPage = Math.max(1, Math.trunc(Number(options?.page) || 1));
    const offset = (requestedPage - 1) * pageSize;
    const items = [];
    let total = 0;
    for (const row of dictionaryLookup(catalog)?.searchRows || []) {
      if (!pickerSearchMatch(row, terms, roleType)) continue;
      total++;
      if (total > offset && items.length < pageSize) items.push(row.item);
    }
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (requestedPage > pageCount && total) return searchPickerPage(catalog, { ...options, page: pageCount, pageSize });
    return {
      items, total, page: Math.min(requestedPage, pageCount), pageSize, pageCount,
      start: total ? offset + 1 : 0,
      end: total ? offset + items.length : 0,
      query: normalizeSpace(query), roleType,
    };
  }

  // Backward-compatible one-page helper used by older tests and integrations.
  function searchPickerEntries(catalog, query = '', limit = 80) {
    const page = searchPickerPage(catalog, { query, roleType: 'all', page: 1, pageSize: limit });
    return { items: page.items, total: page.total };
  }

  function pickerDetailValue(item, aliases) {
    const wanted = new Set((aliases || []).map(searchCanonical));
    for (const part of String(item?.details || '').split(/\\s+\\|\\s+/)) {
      const at = part.indexOf(':');
      if (at <= 0) continue;
      if (!wanted.has(searchCanonical(part.slice(0, at)))) continue;
      return normalizeSpace(part.slice(at + 1));
    }
    return '';
  }

  function pickerCompactList(value, limit = 180) {
    const unique = [...new Set(String(value || '').split(/\\s*;\\s*/).map(normalizeSpace).filter(Boolean))];
    const text = unique.join(', ');
    return text.length > limit ? \`${'${text.slice(0, Math.max(1, limit - 1))}'}…\` : text;
  }

  function pickerEntryPresentation(item) {
    const value = String(item?.selector || item?.display || '').trim();
    const roleType = canonicalValue(item?.roleTypeId);
    const roleFullName = pickerDetailValue(item, ['RoleFullName', 'UserFullName']);
    const position = pickerCompactList(pickerDetailValue(item, ['RolePositionName', 'UserPosition', 'PositionName', 'Position']));
    const department = pickerCompactList(pickerDetailValue(item, ['Departments', 'UserDepartment', 'Department', 'Info']));
    const isPerson = roleType === '1' || Boolean(roleFullName);
    const title = isPerson ? (roleFullName || normalizeSpace(item?.qualifier) || normalizeSpace(item?.display) || value) : (normalizeSpace(item?.display) || value);
    const typeLabel = roleType ? previewRoleTypeLabel(roleType) : '';
    const subtitle = [...new Set([position, department, typeLabel].filter(Boolean))].join(' · ');
    return { title, subtitle, typeLabel, value };
  }

  function pickerSelectionValue(item) {
    const value = String(item?.selector || item?.display || '').trim();
    if (/[\\n\\r;\\t]/.test(value)) throw new Error('В названии есть разделитель. Такое значение нельзя собрать автоматически. Выберите его в штатном редакторе TESSA.');
    if (/^[=+@-]/.test(value)) throw new Error('Название начинается со знака формулы. Выберите его в штатном редакторе TESSA.');
    return value;
  }

  // Clipboard payload is plain text for Excel edit mode. Do not silently split
  // a selector containing delimiters or allow a pasted formula prefix.
  function pickerSelectionText(items) {
    const unique = [...new Map((items || []).map(item => [pickerEntryKey(item), item])).values()];
    const result = unique.map(pickerSelectionValue).join('\\n');
    if (result.length > 32767) throw new Error('В ячейке Excel может быть не больше 32767 символов. Уменьшите выбор.');
    return result;
  }

  function bulkSelectPickerItems(selected, candidates, maxChars = 32767) {
    const output = new Map(selected instanceof Map ? selected : []);
    let currentText = pickerSelectionText([...output.values()]);
    let currentLength = currentText.length;
    let added = 0, skippedUnsafe = 0, capacityReached = false;
    for (const item of candidates || []) {
      const key = pickerEntryKey(item);
      if (output.has(key)) continue;
      let value;
      try { value = pickerSelectionValue(item); }
      catch (_) { skippedUnsafe++; continue; }
      const nextLength = currentLength + (currentLength ? 1 : 0) + value.length;
      if (nextLength > maxChars) { capacityReached = true; break; }
      output.set(key, item);
      currentLength = nextLength;
      added++;
    }
    return { selected: output, added, skippedUnsafe, capacityReached, length: currentLength };
  }

  function bulkSelectPickerMatches(selected, catalog, options = {}) {
    const terms = searchCanonical(options?.query || '').split(/\\s+/).filter(Boolean);
    const roleType = canonicalValue(options?.roleType || 'all') || 'all';
    const matches = [];
    for (const row of dictionaryLookup(catalog)?.searchRows || []) {
      if (pickerSearchMatch(row, terms, roleType)) matches.push(row.item);
    }
    return bulkSelectPickerItems(selected, matches, options?.maxChars ?? 32767);
  }`;
replaceOnce(pickerStart, pickerCore, 'replace picker core');

replaceOnce(
`    createRuntimeMonitor, pickerColumns, pickerEntryKey, searchPickerEntries, pickerSelectionText,`,
`    createRuntimeMonitor, pickerColumns, pickerEntryKey, pickerRoleTypeOptions, pickerDefaultRoleFilter, searchPickerPage, searchPickerEntries, pickerEntryPresentation, bulkSelectPickerItems, bulkSelectPickerMatches, pickerSelectionText,`,
'export picker core');
replaceOnce(
`    finalizeDictionaryEntries, dictionaryLookup, resolveEmbeddedDictionaryValue, normalizeDictionaryCatalog, searchCanonical, booleanSemantic, booleanDisplay, humanQualifierFromDetails, detectPlanDuplicateConflicts, friendlyErrorMessage,`,
`    finalizeDictionaryEntries, dictionaryLookup, resolveEmbeddedDictionaryValue, normalizeDictionaryCatalog, searchCanonical, booleanSemantic, booleanDisplay, humanQualifierFromDetails, partnerRecordKeepingColumnIndex, detectPlanDuplicateConflicts, friendlyErrorMessage,`,
'export partner detector');

fs.writeFileSync(file, source);

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
for (const test of [
  'tests/schema-refresh-circular-regression.mjs',
  'tests/picker-production-ux.mjs',
  'tests/record-keeping-partners.mjs',
  'tests/picker-performance.mjs',
]) {
  const command = `node ${test}`;
  if (!pkg.scripts.test.includes(command)) pkg.scripts.test += ` && ${command}`;
}
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('picker/partner core patch applied');
