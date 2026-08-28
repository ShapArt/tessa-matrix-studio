import fs from 'node:fs';

const path = 'CHANGELOG.md';
let text = fs.readFileSync(path, 'utf8');
const tail = '## 1.8.6\n\n- исправлено ложное удаление при копировании строки с повторяющимися служебными ID;\n- добавлена защита от неявного удаления при конфликте identity.\n';
if (text.includes('## 1.8.6')) throw new Error('Historical v1.8.6 section already exists; refusing duplicate append.');
if (!text.endsWith('\n')) text += '\n';
text += `\n${tail}`;
fs.writeFileSync(path, text);
console.log('Restored historical v1.8.6 changelog tail.');
