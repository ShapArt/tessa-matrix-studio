import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const oldBlock = `  function spreadsheetRowNumber(raw, fallback, limits) {\n    if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;\n    const text = String(raw).trim();\n    if (!/^[1-9]\\d*$/.test(text)) throw xlsxArchiveError(\`некорректный номер строки «\${text || '(пусто)'}» в SpreadsheetML.\`);\n    const value = Number(text);\n    if (!Number.isSafeInteger(value) || value < 1) throw xlsxArchiveError(\`некорректный номер строки «\${text}» в SpreadsheetML.\`);\n    if (value > limits.MaxRowNumber) throw xlsxArchiveError(\`номер строки \${value} превышает безопасный лимит \${limits.MaxRowNumber}.\`);\n    return value;\n  }`;
const newBlock = `  function spreadsheetRowNumber(raw, fallback, limits) {\n    const hasExplicit = raw !== null && raw !== undefined && String(raw).trim() !== '';\n    const text = hasExplicit ? String(raw).trim() : String(fallback);\n    if (!/^[1-9]\\d*$/.test(text)) throw xlsxArchiveError(\`некорректный номер строки «\${text || '(пусто)'}» в SpreadsheetML.\`);\n    const value = Number(text);\n    if (!Number.isSafeInteger(value) || value < 1) throw xlsxArchiveError(\`некорректный номер строки «\${text}» в SpreadsheetML.\`);\n    if (value > limits.MaxRowNumber) throw xlsxArchiveError(\`номер строки \${value} превышает безопасный лимит \${limits.MaxRowNumber}.\`);\n    return value;\n  }`;
const index = source.indexOf(oldBlock);
if (index < 0) throw new Error('spreadsheetRowNumber anchor not found');
if (source.indexOf(oldBlock, index + oldBlock.length) >= 0) throw new Error('spreadsheetRowNumber anchor not unique');
source = source.slice(0, index) + newBlock + source.slice(index + oldBlock.length);
fs.writeFileSync(path, source);
console.log('Fixed implicit SpreadsheetML row ceiling.');
