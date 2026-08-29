from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

old_lookup = "    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean };\n"
new_lookup = "    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean, resolutionCache: new Map() };\n"
if old_lookup not in s:
    if new_lookup not in s:
        raise SystemExit('dictionary lookup anchor not found')
else:
    s = s.replace(old_lookup, new_lookup, 1)

old_block = '''    const needle = searchCanonical(visibleText);
    const tokens = searchTokens(visibleText);
    const allowPartial = needle.length >= 2 && !/^\\d+$/.test(needle);
    if (allowPartial) {
      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);
      if (partial.length === 1) return resolvedItem(partial[0], 'unique-fragment');
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';
        return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` };
      }
    }
    return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` };
'''
new_block = '''    const resolutionCache = lookup.resolutionCache || (lookup.resolutionCache = new Map());
    const resolutionCacheKey = `${canonicalValue(column.kind)}|${canonicalValue(column.excelHeader)}|${visibleCanonical}`;
    if (resolutionCache.has(resolutionCacheKey)) return resolutionCache.get(resolutionCacheKey);
    const cacheResolution = result => {
      // Bound per-catalog typo/fragment cache so a pathological workbook with hundreds of
      // thousands of distinct bad values cannot retain an unbounded number of result objects.
      if (resolutionCache.size >= 2048 && !resolutionCache.has(resolutionCacheKey)) {
        const oldest = resolutionCache.keys().next().value;
        if (oldest !== undefined) resolutionCache.delete(oldest);
      }
      resolutionCache.set(resolutionCacheKey, result);
      return result;
    };

    const needle = searchCanonical(visibleText);
    const tokens = searchTokens(visibleText);
    const allowPartial = needle.length >= 2 && !/^\\d+$/.test(needle);
    if (allowPartial) {
      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);
      if (partial.length === 1) return cacheResolution(resolvedItem(partial[0], 'unique-fragment'));
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';
        return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` });
      }
    }
    return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` });
'''
if old_block not in s:
    if new_block not in s:
        raise SystemExit('dictionary resolution anchor not found')
else:
    s = s.replace(old_block, new_block, 1)

p.write_text(s, encoding='utf-8')
print('v1.9.31 dictionary resolution cache patch applied')
