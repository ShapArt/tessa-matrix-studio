from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

old_shared = r'''  function parseSharedStrings(xml) {
    if (!xml) return [];
    const items = [];
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(x => xmlDecode(x[1]));
      items.push(parts.join(''));
    }
    return items;
  }
'''
new_shared = r'''  function parseSharedStrings(xml) {
    if (!xml) return [];
    const items = [];
    const itemRegex = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gi;
    const textRegex = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi;
    for (const si of xml.matchAll(itemRegex)) {
      const parts = [...si[1].matchAll(textRegex)].map(x => xmlDecode(x[1]));
      items.push(parts.join(''));
    }
    return items;
  }
'''
if old_shared not in text:
    raise SystemExit('parseSharedStrings anchor not found')
text = text.replace(old_shared, new_shared, 1)

old_value = r'''          if (v) {
            const raw = xmlDecode(v[1]);
            value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
          }
'''
new_value = r'''          if (v) {
            const raw = xmlDecode(v[1]);
            if (type === 's') {
              const indexText = String(raw).trim();
              if (!/^(?:0|[1-9]\d*)$/.test(indexText)) {
                throw xlsxArchiveError(`некорректный индекс общей строки «${indexText || '(пусто)'}» в sharedStrings.`);
              }
              const sharedIndex = Number(indexText);
              if (!Number.isSafeInteger(sharedIndex) || sharedIndex < 0 || sharedIndex >= sharedStrings.length) {
                throw xlsxArchiveError(`индекс общей строки ${indexText} выходит за предел таблицы sharedStrings (${sharedStrings.length}).`);
              }
              value = sharedStrings[sharedIndex];
            } else value = raw;
          }
'''
if old_value not in text:
    raise SystemExit('shared-string cell anchor not found')
text = text.replace(old_value, new_value, 1)

path.write_text(text, encoding='utf-8')
print('v1.9.29 GREEN parser patch applied')
