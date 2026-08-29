from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
old = r'''  function parseWorkbookSheets(entries, decoder) {
    const workbook = decoder.decode(entries.get('xl/workbook.xml') || new Uint8Array());
    const rels = decoder.decode(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const relationships = new Map();
    for (const match of rels.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
      const id = attr(match[1], 'Id');
      const target = attr(match[1], 'Target');
      if (id && target) relationships.set(id, target);
    }
    const sheets = [];
    for (const match of workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi)) {
      const sheetName = attr(match[1], 'name') || `Лист${sheets.length + 1}`;
      const relId = attr(match[1], 'r:id') || attr(match[1], 'id');
      const target = relationships.get(relId) || `worksheets/sheet${sheets.length + 1}.xml`;
      const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      sheets.push({ name: sheetName, path: normalized.replace(/\/\.\//g, '/'), relId });
    }
    return sheets.length ? sheets : [{ name: 'Лист1', path: 'xl/worksheets/sheet1.xml', relId: 'rId1' }];
  }
'''
new = r'''  function resolveOpcRelationshipTarget(sourcePart, target) {
    const raw = String(target || '').trim().replace(/\\/g, '/');
    if (!raw) return '';
    // Worksheet relationships must stay inside the OPC package. External URI schemes
    // are not valid worksheet parts and must not be rewritten into a guessed ZIP path.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith('//')) {
      throw xlsxArchiveError(`внешняя ссылка Relationship «${raw}» не может использоваться как лист XLSX.`);
    }
    const source = String(sourcePart || '').replace(/^\/+/, '');
    const base = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
    const combined = raw.startsWith('/') ? raw.slice(1) : `${base}${raw}`;
    const parts = [];
    for (const part of combined.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw xlsxArchiveError(`Relationship «${raw}» выходит за предел корня XLSX-пакета.`);
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    if (!parts.length) throw xlsxArchiveError(`Relationship «${raw}» не указывает на часть XLSX-пакета.`);
    return parts.join('/');
  }

  function parseWorkbookSheets(entries, decoder) {
    const workbookPath = 'xl/workbook.xml';
    const workbook = decoder.decode(entries.get(workbookPath) || new Uint8Array());
    const rels = decoder.decode(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const relationships = new Map();
    for (const match of rels.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
      const id = attr(match[1], 'Id');
      const target = attr(match[1], 'Target');
      if (id && target) relationships.set(id, target);
    }
    const sheets = [];
    for (const match of workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi)) {
      const sheetName = attr(match[1], 'name') || `Лист${sheets.length + 1}`;
      const relId = attr(match[1], 'r:id') || attr(match[1], 'id');
      const target = relationships.get(relId) || `worksheets/sheet${sheets.length + 1}.xml`;
      const normalized = resolveOpcRelationshipTarget(workbookPath, target);
      sheets.push({ name: sheetName, path: normalized, relId });
    }
    return sheets.length ? sheets : [{ name: 'Лист1', path: 'xl/worksheets/sheet1.xml', relId: 'rId1' }];
  }
'''
if old not in s:
    raise SystemExit('parseWorkbookSheets anchor not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('v1.9.30 office relationship patch applied')
