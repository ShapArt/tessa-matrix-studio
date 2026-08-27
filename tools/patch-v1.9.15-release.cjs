const fs = require('fs');

function edit(path, changes) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of changes) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${path} / ${label}: expected exactly one anchor, got ${count}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

edit('tessa-matrix-studio.user.js', [
  ['// @version      1.9.14', '// @version      1.9.15', 'metadata version'],
  ["    version: '1.9.14',", "    version: '1.9.15',", 'APP version'],
]);

edit('package.json', [
  ['"version": "1.9.14"', '"version": "1.9.15"', 'package version'],
]);

edit('tests/smoke.mjs', [
  ["assert(code.includes('// @version      1.9.14'), 'wrong userscript version');", "assert(code.includes('// @version      1.9.15'), 'wrong userscript version');", 'smoke version'],
]);

edit('.github/ISSUE_TEMPLATE/bug_report.yml', [
  ['      placeholder: 1.9.14', '      placeholder: 1.9.15', 'issue version'],
  ['        - Скачать Excel\n', '        - Скачать Excel\n        - Скачать QA-набор\n', 'QA operation option'],
]);

const qaDocs = `## QA-набор для проверки всех сценариев\n\nНачиная с **v1.9.15**, Studio умеет собрать тестовый пакет прямо из открытой матрицы. Нажмите **Скачать QA-набор** — Studio перечитает текущие строки и справочники и создаст ZIP, привязанный к реальным **MatrixID / TemplateID / MatrixRowID / MatrixVersionID** этой матрицы. Поэтому эти XLSX можно сразу загружать обратно в ту же тестовую матрицу.\n\n> [!CAUTION]\n> Генерируйте QA-набор только на **тестовой или черновой матрице минимум с 3 строками**. Файлы PATCH / ADD / REPLACE / DELETE при нажатии Apply действительно меняют матрицу. Для первичной проверки достаточно загрузить файл и нажать **Проверить изменения**.\n\nВ ZIP находятся `README_QA.md`, `QA_PACK_MANIFEST.json` и изолированные Excel-сценарии. Начинайте с **\\`00_QA_SMOKE_PREVIEW.xlsx\\`**: он специально содержит одновременно корректный PATCH, корректный ADD и одну ошибочную строку, которая должна уйти в SKIP; при этом **DELETE должен остаться 0**.\n\nДальше можно прогнать отдельные файлы: NOOP, PATCH, PATCH нескольких полей, ADD, REPLACE, DELETE, очистка строки вместо DELETE, несуществующее значение справочника, повреждённые hidden-ID, повреждённый fingerprint, неоднозначная копия, DELETE + schema refresh, другая MatrixID и другой TemplateID. После любого реального Apply скачайте QA-набор заново — исходный baseline уже изменился.\n\n### Почему QA-файлы используют Roundtrip V6\n\nRoundtrip V6 сохраняет отдельный veryHidden **baseline-ledger** с исходными `MatrixRowID`, `MatrixVersionID` и `BaseFingerprint`. Он нужен не для редактирования пользователем, а чтобы Studio могла отличить настоящее физическое удаление строки от повреждения hidden-ID и проверить, не изменилась ли удаляемая строка в TESSA после выгрузки. Если identity или fingerprint повреждены либо DELETE стал stale, Studio должна отказаться от угадывания.\n\n---\n\n`;

edit('README.md', [
  ['version-1.9.14-EF233C', 'version-1.9.15-EF233C', 'version badge'],
  ['**v1.9.14 · Автор: Шаповалов Артём**', '**v1.9.15 · Автор: Шаповалов Артём**', 'header version'],
  ['Подтвердите установку версии **1.9.14** в Tampermonkey.', 'Подтвердите установку версии **1.9.15** в Tampermonkey.', 'quick start version'],
  ['- **Версия:** `1.9.14`', '- **Версия:** `1.9.15`', 'install version'],
  ['Текущая версия: **1.9.14**', 'Текущая версия: **1.9.15**', 'support version'],
  ['| **Скачать со свежими справочниками** | если справочники TESSA недавно менялись |\n', '| **Скачать со свежими справочниками** | если справочники TESSA недавно менялись |\n| **Скачать QA-набор** | создать привязанный к текущей тестовой матрице ZIP с позитивными и негативными XLSX-сценариями |\n', 'buttons table'],
  ['---\n\n# Права и безопасность', `---\n\n${qaDocs}# Права и безопасность`, 'QA documentation section'],
]);

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.startsWith('# Changelog\n')) throw new Error('CHANGELOG header anchor missing');
const releaseEntry = `# Changelog\n\n## 1.9.15 — 2026-08-27\n\n- roundtrip-формат поднят до **V6**: в veryHidden baseline-ledger сохраняются исходные MatrixRowID / MatrixVersionID / BaseFingerprint для безопасной проверки удаления и целостности;\n- «Актуализировать выбранный Excel» сохраняет физический DELETE, но останавливается с конфликтом, если удаляемая строка уже изменилась в TESSA;\n- потеря hidden-ID или BaseFingerprint больше не может превратиться в случайный ADD + DELETE — повреждённая identity переводится в SKIP/блокировку;\n- добавлена кнопка **«Скачать QA-набор»**: Studio строит из текущей тестовой матрицы ZIP с 15 XLSX-сценариями, README_QA и manifest; каждый generated XLSX regression-тестом читается обратно штатным parser/planner;\n- в QA-паке есть быстрый \\`00_QA_SMOKE_PREVIEW.xlsx\\` и изолированные NOOP / PATCH / multi-PATCH / ADD / REPLACE / DELETE / invalid dictionary / hidden-ID / fingerprint / ambiguity / wrong matrix/template / schema-refresh DELETE сценарии;\n- опубликованные версии сделаны неизменяемыми: Release workflow отказывается перезаписывать существующий release/tag вместо \\`--clobber\\`;\n- добавлен ежедневный **Delivery Canary**, который анонимно проверяет latest metadata/userscript/ZIP и SHA-256 публичной доставки.\n`;
fs.writeFileSync('CHANGELOG.md', changelog.replace('# Changelog\n', releaseEntry));

console.log('v1.9.15 release/docs patch applied.');
