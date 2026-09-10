import fs from 'node:fs';

const path = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(path, 'utf8');

const replacements = [
  [
`  // SpreadsheetML itself is untrusted even after the ZIP package passes archive guards.\n  // These ceilings prevent tiny XML from materializing pathological sparse arrays or\n  // forcing the browser to parse an unreasonable number of physical row/cell nodes.\n  const SPREADSHEETML_LIMITS = Object.freeze({\n    MaxRowNumber: 1048576,\n    MaxColumnNumber: 16384, // Excel XFD\n    MaxParsedRows: 1048576,\n    MaxParsedCells: 1500000,\n  });`,
`  // SpreadsheetML coordinates are bounded by the actual Excel worksheet address space.\n  // Do not impose arbitrary physical row/cell-count ceilings here: TESSA roundtrip books\n  // may legitimately contain very large service sheets (especially «Словари»).\n  const SPREADSHEETML_LIMITS = Object.freeze({\n    MaxRowNumber: 1048576,\n    MaxColumnNumber: 16384, // Excel XFD\n  });`
  ],
  [
`    let maxCol = 0;\n    let parsedRowCount = 0;\n    let parsedCellCount = 0;\n    let nextImplicitRow = 1;`,
`    let maxCol = 0;\n    let nextImplicitRow = 1;`
  ],
  [
`    for (const rowMatch of xml.matchAll(rowRegex)) {\n      parsedRowCount += 1;\n      if (parsedRowCount > limits.MaxParsedRows) {\n        throw xlsxArchiveError(\`слишком много строк SpreadsheetML (\${parsedRowCount} > \${limits.MaxParsedRows}).\`);\n      }\n      const explicitRow = attr(rowMatch[1], 'r');`,
`    for (const rowMatch of xml.matchAll(rowRegex)) {\n      const explicitRow = attr(rowMatch[1], 'r');`
  ],
  [
`      for (const cellMatch of body.matchAll(cellRegex)) {\n        parsedCellCount += 1;\n        if (parsedCellCount > limits.MaxParsedCells) {\n          throw xlsxArchiveError(\`слишком много ячеек SpreadsheetML (\${parsedCellCount} > \${limits.MaxParsedCells}).\`);\n        }\n        const attrs = cellMatch[1] || '';`,
`      for (const cellMatch of body.matchAll(cellRegex)) {\n        const attrs = cellMatch[1] || '';`
  ],
];

let changed = false;
for (const [before, after] of replacements) {
  if (code.includes(after)) continue;
  const count = code.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one production snippet, found ${count}: ${before.slice(0, 100)}`);
  code = code.replace(before, after);
  changed = true;
}

if (!changed) {
  console.log('SpreadsheetML physical count limits already removed.');
  process.exit(0);
}

fs.writeFileSync(path, code);
console.log('Removed arbitrary SpreadsheetML physical row/cell count ceilings; retained Excel coordinate bounds.');
