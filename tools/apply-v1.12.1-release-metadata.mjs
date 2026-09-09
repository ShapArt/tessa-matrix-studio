import fs from 'node:fs';

function read(path) { return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
function write(path, value) { fs.writeFileSync(new URL(`../${path}`, import.meta.url), value); }
function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`pattern not found: ${label}`);
  return text.replace(before, after);
}

let lock = read('package-lock.json');
let replacements = 0;
lock = lock.replace(/"version": "1\.12\.0"/g, match => {
  replacements += 1;
  return replacements <= 2 ? '"version": "1.12.1"' : match;
});
if (replacements < 2) throw new Error(`package-lock root versions not found: ${replacements}`);
write('package-lock.json', lock);

let readme = read('README.md');
readme = replaceRequired(readme, 'version-1.12.0-', 'version-1.12.1-', 'README badge');
readme = replaceRequired(readme, '**v1.12.0 · Автор: Шаповалов Артём**', '**v1.12.1 · Автор: Шаповалов Артём**', 'README header');
readme = replaceRequired(readme, 'Подтвердите установку версии **1.12.0**', 'Подтвердите установку версии **1.12.1**', 'README install');
readme = replaceRequired(readme, 'Текущая версия: **1.12.0**', 'Текущая версия: **1.12.1**', 'README support');
write('README.md', readme);

let changelog = read('CHANGELOG.md');
if (!changelog.includes('## 1.12.1 —')) {
  const marker = '# История изменений\n\n';
  if (!changelog.startsWith(marker)) throw new Error('CHANGELOG header not found');
  changelog = marker + `## 1.12.1 — 2026-09-09\n\n- Исправлен опубликованный post-Apply учёт: успешные Store/Delete больше не превращаются в «0 применено» при неполной повторной проверке.\n- После успешных операций строк Studio выполняет отдельное безопасное сохранение основной карточки матрицы через CardStoreRequest с ForceTransaction, без отправки неизменённых полей.\n- Повторная проверка умеет точечно сверять mutation receipts, если нативное представление не отдаёт MatrixRowID одной из посторонних строк.\n- «Скачать отчёт для поддержки» работает и после Apply: отчёт сохраняется до инвалидирования Preview, а браузерная загрузка выполняется через прикреплённую ссылку с корректной очисткой Blob URL.\n- В отчёт поддержки добавлены обезличенные статусы сохранения матрицы, обновления представления и reconciliation.\n\n` + changelog.slice(marker.length);
}
write('CHANGELOG.md', changelog);

let bug = read('.github/ISSUE_TEMPLATE/bug_report.yml');
bug = replaceRequired(bug, 'placeholder: 1.12.0', 'placeholder: 1.12.1', 'bug template version');
write('.github/ISSUE_TEMPLATE/bug_report.yml', bug);

console.log('Applied v1.12.1 release metadata');
