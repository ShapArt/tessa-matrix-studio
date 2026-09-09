import fs from 'node:fs';

function update(path, transform) {
  const url = new URL(`../${path}`, import.meta.url);
  const before = fs.readFileSync(url, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: expected metadata change was not produced`);
  fs.writeFileSync(url, after);
}

update('package-lock.json', text => {
  let next = text.replace('"version": "1.12.1"', '"version": "1.12.2"');
  next = next.replace('"version": "1.12.1"', '"version": "1.12.2"');
  return next;
});

update('README.md', text => text
  .replace('version-1.12.1-', 'version-1.12.2-')
  .replace('**v1.12.1 · Автор: Шаповалов Артём**', '**v1.12.2 · Автор: Шаповалов Артём**')
  .replace('Подтвердите установку версии **1.12.1**', 'Подтвердите установку версии **1.12.2**')
  .replace('Текущая версия: **1.12.1**', 'Текущая версия: **1.12.2**'));

update('.github/ISSUE_TEMPLATE/bug_report.yml', text => text.replace('placeholder: 1.12.1', 'placeholder: 1.12.2'));

update('CHANGELOG.md', text => {
  if (text.includes('## 1.12.2 —')) return text;
  const heading = '# Changelog';
  const entry = `\n\n## 1.12.2 — 2026-09-09\n\n- DELETE теперь является реальным изменением состава \\`MtxRouteMatrixRows\\`: строка секции помечается \\`Deleted\\` и считается применённой только после сохранения изменённой основной карточки.\n- Удалён некорректный пустой \\`forceTransaction\\` Store основной карточки; Store содержит реальные changed-state данные и больше не вызывает \\`CheckRequestStoreExtension\\` из-за искусственного пустого запроса.\n- Результат Apply отдельно показывает, сколько операций сервер принял и сколько повторное чтение подтвердило; расхождения DELETE больше не маскируются сообщением «подтверждено 4 из 4».\n- Известный \\`LeftOperandExtractor is null\\` для интервального \\`ValidateDuplicate\\` классифицируется как ограничение серверного контракта и не ломает весь диагностический прогон.\n- В «Проверки и диагностика» добавлена выгрузка нативного runtime-интерфейса TESSA и ограниченная запись одного штатного действия для исследования реального CardService/состава матрицы без бизнес-значений.\n- Живой кейс 2026-09-09 превращён в обязательные regression tests: accepted-vs-verified, DELETE membership transition, changed-card save, interval capability и native runtime recorder.\n`;
  if (!text.startsWith(heading)) throw new Error('CHANGELOG heading not found');
  return heading + entry + text.slice(heading.length);
});

console.log('Applied v1.12.2 release metadata');
