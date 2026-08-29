from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

old = "    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean };\n"
new = "    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean, resolutionCache: new Map() };\n"
if old not in s:
    if new not in s:
        raise SystemExit('dictionaryLookup anchor not found')
else:
    s = s.replace(old, new, 1)

old = """    const explicitRoleType = canonicalValue(explicitParts[1] || '');\n\n    const resolvedItem = (item, resolution = 'exact') => ({\n"""
new = """    const explicitRoleType = canonicalValue(explicitParts[1] || '');\n    const resolutionCacheKey = [\n      canonicalValue(column.kind), canonicalValue(column.excelHeader), visibleCanonical, explicitId, explicitRoleType,\n    ].join('|');\n    const cachedResolution = lookup?.resolutionCache?.get(resolutionCacheKey);\n    if (cachedResolution) return { ...cachedResolution };\n    const cacheResolution = result => {\n      if (lookup?.resolutionCache) lookup.resolutionCache.set(resolutionCacheKey, { ...result });\n      return result;\n    };\n\n    const resolvedItem = (item, resolution = 'exact') => ({\n"""
if old not in s:
    if new not in s:
        raise SystemExit('resolve cache anchor not found')
else:
    s = s.replace(old, new, 1)

old = """      if (partial.length === 1) return resolvedItem(partial[0], 'unique-fragment');\n      if (partial.length > 1) {\n        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');\n        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';\n        return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` };\n      }\n    }\n    return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` };\n"""
new = """      if (partial.length === 1) return cacheResolution(resolvedItem(partial[0], 'unique-fragment'));\n      if (partial.length > 1) {\n        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');\n        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';\n        return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` });\n      }\n    }\n    return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` });\n"""
if old not in s:
    if new not in s:
        raise SystemExit('partial search anchor not found')
else:
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('v1.9.31 dictionary fallback cache patch applied')
