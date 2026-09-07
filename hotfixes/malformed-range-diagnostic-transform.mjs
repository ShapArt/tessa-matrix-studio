import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const BEFORE = String.raw`  function splitRangeText(value, kind = null) {
    const text = stripFormulaMarker(value);
    if (kind === 'Int' || kind === 'Decimal') {
      const numeric = text.replace(/\s/g, '').match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))(?:-|\.\.|до)([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/i);
      if (numeric) return [numeric[1], numeric[2]];
    }
    const match = text.match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : [text, null];
  }`;

const AFTER = String.raw`  function splitRangeText(value, kind = null) {
    const text = stripFormulaMarker(value);
    if (kind === 'Int' || kind === 'Decimal') {
      // Numeric ranges have an exact grammar. If the whole cell does not match it,
      // keep the original text intact so validation reports the actual malformed
      // Excel value instead of a misleading tail fragment (e.g. "2 - 3" from
      // the invalid "1 - 2 - 3").
      const numeric = text.replace(/\s/g, '').match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))(?:-|–|—|\.\.|до)([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/i);
      return numeric ? [numeric[1], numeric[2]] : [text, null];
    }
    const match = text.match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : [text, null];
  }`;

export function applyMalformedRangeDiagnosticTransform(source) {
  const text = String(source ?? '');
  const occurrences = text.split(BEFORE).length - 1;
  if (occurrences !== 1) {
    throw new Error(`malformed-range transform expected exactly one splitRangeText source block, found ${occurrences}`);
  }
  return text.replace(BEFORE, AFTER);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node malformed-range-diagnostic-transform.mjs <userscript>');
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, applyMalformedRangeDiagnosticTransform(source));
}
