import fs from 'node:fs';

const path = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(path, 'utf8');

const replacements = [
  ['MaxRowNumber: 200000', 'MaxRowNumber: 1048576'],
  ['MaxParsedRows: 200000', 'MaxParsedRows: 1048576'],
];

for (const [before, after] of replacements) {
  if (code.includes(after)) continue;
  const count = code.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one occurrence of ${before}, found ${count}`);
  code = code.replace(before, after);
}

fs.writeFileSync(path, code);
console.log('XLSX row-limit hotfix applied: valid Excel rows up to 1048576 are allowed.');
