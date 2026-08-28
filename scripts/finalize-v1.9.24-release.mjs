import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`Non-unique ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

let user = fs.readFileSync('tessa-matrix-studio.user.js', 'utf8');
user = replaceOnce(user, '// @version      1.9.23', '// @version      1.9.24', 'userscript metadata version');
user = replaceOnce(user, "    version: '1.9.23',", "    version: '1.9.24',", 'APP version');
fs.writeFileSync('tessa-matrix-studio.user.js', user);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '1.9.24';
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

let readme = fs.readFileSync('README.md', 'utf8');
readme = replaceOnce(readme, 'version-1.9.23-EF233C', 'version-1.9.24-EF233C', 'README badge');
readme = replaceOnce(readme, '**v1.9.23 · Автор: Шаповалов Артём**', '**v1.9.24 · Автор: Шаповалов Артём**', 'README hero version');
readme = replaceOnce(readme, 'Подтвердите установку версии **1.9.23** в Tampermonkey.', 'Подтвердите установку версии **1.9.24** в Tampermonkey.', 'README quick-start version');
readme = replaceOnce(readme, '- **Версия:** `1.9.23`', '- **Версия:** `1.9.24`', 'README install version');
readme = replaceOnce(readme, 'Текущая версия: **1.9.23**', 'Текущая версия: **1.9.24**', 'README support version');
const tipAnchor = '> [!TIP]\n> Перед первой правкой сохраните исходную выгрузку отдельно.';
const spreadsheetNote = '> [!IMPORTANT]\n> Начиная с **v1.9.24**, после ZIP/OPC-проверки каждый SpreadsheetML-лист проходит отдельную структурную валидацию до построения workbook: Studio ограничивает используемый номер строки **100 000**, столбцы — штатным пределом Excel **XFD / 16 384**, физически разбираемые строки — **100 000**, ячейки — **500 000**. Дубли номеров строк/координат ячеек, некорректные ссылки и несовпадение `cell r` с родительской строкой приводят к `XLSX отклонён`; такой файл не доходит до Preview/Apply.\n\n';
readme = replaceOnce(readme, tipAnchor, `${spreadsheetNote}${tipAnchor}`, 'README SpreadsheetML note anchor');
fs.writeFileSync('README.md', readme);

let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const releaseNotes = `## 1.9.24 — 2026-08-28\n\n- добавлена fail-closed структурная проверка SpreadsheetML после ZIP/OPC guard и до построения workbook/Preview;\n- максимальный используемый номер строки ограничен 100 000, столбцы — штатным пределом Excel XFD / 16 384;\n- физически разбираемые XML-узлы ограничены 100 000 строками и 500 000 ячейками на лист, чтобы компактный патологический XML не мог разогнать CPU/RAM;\n- отклоняются дубли номеров строк и координат ячеек, нулевые/повреждённые references, координаты за XFD и несовпадение номера строки ячейки с родительским <row>;\n- regression suite покрывает row ceiling, XFE, excessive rows/cells, duplicate coordinates, row/cell mismatch и malformed zero references; обычный namespaced SpreadsheetML и Roundtrip V6 сохраняют совместимость.\n\n`;
changelog = replaceOnce(changelog, '# Changelog\n\n', `# Changelog\n\n${releaseNotes}`, 'CHANGELOG heading');
fs.writeFileSync('CHANGELOG.md', changelog);

let issue = fs.readFileSync('.github/ISSUE_TEMPLATE/bug_report.yml', 'utf8');
issue = replaceOnce(issue, 'placeholder: 1.9.23', 'placeholder: 1.9.24', 'issue version');
issue = replaceOnce(issue, '        - Выбрать Excel — XLSX отклонён / ZIP security\n', '        - Выбрать Excel — XLSX отклонён / ZIP security\n        - Выбрать Excel — XLSX отклонён / SpreadsheetML security\n', 'issue SpreadsheetML scenario');
fs.writeFileSync('.github/ISSUE_TEMPLATE/bug_report.yml', issue);

console.log('Prepared v1.9.24 release files.');
