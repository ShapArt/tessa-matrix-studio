from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')

old = """  function parseSharedStrings(xml) {
    if (!xml) return [];
"""
new = """  const BUILTIN_EXCEL_DATE_FORMAT_IDS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  ]);

  function excelNumberFormatKind(numFmtId, formatCode = '') {
    const id = Number(numFmtId);
    if (id === 49) return 'text';
    if (BUILTIN_EXCEL_DATE_FORMAT_IDS.has(id)) return 'date';
    const code = String(formatCode || '').trim();
    if (!code) return 'general';
    if (code === '@') return 'text';
    const semantic = code
      .replace(/\"(?:[^\"]|\"\")*\"/g, '')
      .replace(/\\\\./g, '')
      .replace(/[_*]./g, '')
      .replace(/\\[(?!h+\\]|m+\\]|s+\\])[^\\]]*\\]/gi, '')
      .toLowerCase();
    if (/am\\/pm|a\\/p|\\[h+\\]|\\[m+\\]|\\[s+\\]|y+|d+|h+|s+/.test(semantic)) return 'date';
    if (/m+/.test(semantic) && /[\\/-]/.test(semantic)) return 'date';
    return 'general';
  }

  function parseStylesXml(xml) {
    if (!xml) return [];
    const customFormats = new Map();
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\\w.-]*:)?numFmt\\b([^>]*?)(?:\\/\\s*>|>)/gi)) {
      const id = Number(attr(match[1], 'numFmtId'));
      const code = attr(match[1], 'formatCode') || '';
      if (Number.isInteger(id) && id >= 0) customFormats.set(id, code);
    }
    const cellXfsMatch = xml.match(/<(?:[A-Za-z_][\\w.-]*:)?cellXfs\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?cellXfs>/i);
    if (!cellXfsMatch) return [];
    const styles = [];
    for (const match of cellXfsMatch[1].matchAll(/<(?:[A-Za-z_][\\w.-]*:)?xf\\b([^>]*?)(?:\\/\\s*>|>)/gi)) {
      const numFmtId = Number(attr(match[1], 'numFmtId') || 0);
      const formatCode = customFormats.get(numFmtId) || '';
      styles.push({ numFmtId, formatCode, numberFormatKind: excelNumberFormatKind(numFmtId, formatCode) });
    }
    return styles;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
"""
assert s.count(old) == 1, 'parseSharedStrings anchor mismatch'
s = s.replace(old, new)

old = """  function parseSheetXml(xml, sharedStrings) {
    const limits = effectiveSpreadsheetMlLimits();
    const rows = [];
    const seenRows = new Set();
"""
new = """  function parseSheetXml(xml, sharedStrings, styles = []) {
    const limits = effectiveSpreadsheetMlLimits();
    const rows = [];
    const cellMeta = [];
    const seenRows = new Set();
"""
assert s.count(old) == 1, 'parseSheetXml signature anchor mismatch'
s = s.replace(old, new)

old = """      const values = [];
      const body = rowMatch[2];
      let nextImplicitCol = 0;
"""
new = """      const values = [];
      const metaValues = [];
      const body = rowMatch[2];
      let nextImplicitCol = 0;
"""
assert s.count(old) == 1, 'row values anchor mismatch'
s = s.replace(old, new)

old = """        const type = attr(attrs, 't') || '';
        let value = '';
"""
new = """        const type = attr(attrs, 't') || '';
        const styleIndexRaw = attr(attrs, 's');
        const styleIndex = styleIndexRaw === null ? 0 : Number(styleIndexRaw);
        const style = Number.isInteger(styleIndex) && styleIndex >= 0 ? (styles[styleIndex] || null) : null;
        metaValues[coordinate.col] = {
          styleIndex: Number.isInteger(styleIndex) && styleIndex >= 0 ? styleIndex : 0,
          numFmtId: style?.numFmtId ?? 0,
          formatCode: style?.formatCode || '',
          numberFormatKind: style?.numberFormatKind || 'general',
          rawType: type || 'n',
        };
        let value = '';
"""
assert s.count(old) == 1, 'cell type anchor mismatch'
s = s.replace(old, new)

old = """      rows[rowNumber - 1] = values;
    }
    // Keep missing rows as sparse-array holes. The numeric indexes are still bounded by
    // MaxRowNumber, while avoiding one allocated empty Array for every absent row.
    return { rows, maxCol };
  }
"""
new = """      rows[rowNumber - 1] = values;
      cellMeta[rowNumber - 1] = metaValues;
    }
    // Keep missing rows as sparse-array holes. The numeric indexes are still bounded by
    // MaxRowNumber, while avoiding one allocated empty Array for every absent row.
    return { rows, maxCol, cellMeta };
  }
"""
assert s.count(old) == 1, 'parseSheetXml return anchor mismatch'
s = s.replace(old, new)

old = """    const decoder = new TextDecoder('utf-8');
    const shared = parseSharedStrings(entries.has('xl/sharedStrings.xml') ? decoder.decode(entries.get('xl/sharedStrings.xml')) : '');
    const sheetDescriptors = parseWorkbookSheets(entries, decoder);
    const parsedSheets = new Map();
    for (const descriptor of sheetDescriptors) {
      const raw = entries.get(descriptor.path);
      if (!raw) continue;
      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared));
    }
"""
new = """    const decoder = new TextDecoder('utf-8');
    const shared = parseSharedStrings(entries.has('xl/sharedStrings.xml') ? decoder.decode(entries.get('xl/sharedStrings.xml')) : '');
    const styles = parseStylesXml(entries.has('xl/styles.xml') ? decoder.decode(entries.get('xl/styles.xml')) : '');
    const sheetDescriptors = parseWorkbookSheets(entries, decoder);
    const parsedSheets = new Map();
    for (const descriptor of sheetDescriptors) {
      const raw = entries.get(descriptor.path);
      if (!raw) continue;
      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared, styles));
    }
"""
assert s.count(old) == 1, 'readXlsx styles anchor mismatch'
s = s.replace(old, new)

old = """      const values = Array.from({ length: lastMeaningful }, (_, i) => source[i] ?? '');
      if (values.some(v => normalizeSpace(v))) data.push({ excelRow: r + 1, values });
"""
new = """      const values = Array.from({ length: lastMeaningful }, (_, i) => source[i] ?? '');
      const cellMeta = Array.from({ length: lastMeaningful }, (_, i) => parsed.cellMeta?.[r]?.[i] || null);
      if (values.some(v => normalizeSpace(v))) data.push({ excelRow: r + 1, values, cellMeta });
"""
assert s.count(old) == 1, 'readXlsx row metadata anchor mismatch'
s = s.replace(old, new)

old = '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
new = '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
assert s.count(old) == 1, 'body style 5 anchor mismatch'
s = s.replace(old, new)

old = '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
new = '<xf numFmtId="49" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
assert s.count(old) == 1, 'body style 8 anchor mismatch'
s = s.replace(old, new)

p.write_text(s, encoding='utf-8')
