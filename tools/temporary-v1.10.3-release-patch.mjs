import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(path, before, after) {
  let text = read(path);
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${path}: source not found: ${before}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: source not unique: ${before}`);
  write(path, text.replace(before, after));
}
function replaceCount(path, before, after, expected) {
  let text = read(path);
  const parts = text.split(before);
  const count = parts.length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} occurrence(s) of ${before}, got ${count}`);
  write(path, parts.join(after));
}

replaceOnce('tessa-matrix-studio.user.js', '// @version      1.10.2', '// @version      1.10.3');
replaceOnce('tessa-matrix-studio.user.js', "version: '1.10.2'", "version: '1.10.3'");
replaceOnce('package.json', '"version": "1.10.2"', '"version": "1.10.3"');
replaceCount('package-lock.json', '"version": "1.10.2"', '"version": "1.10.3"', 2);
replaceOnce('.github/ISSUE_TEMPLATE/bug_report.yml', 'placeholder: 1.10.2', 'placeholder: 1.10.3');

replaceOnce('README.md', 'version-1.10.2-EF233C', 'version-1.10.3-EF233C');
replaceOnce('README.md', '**v1.10.2 · Автор: Шаповалов Артём**', '**v1.10.3 · Автор: Шаповалов Артём**');
replaceOnce('README.md', 'Подтвердите установку версии **1.10.2**', 'Подтвердите установку версии **1.10.3**');
replaceOnce('README.md', 'Текущая версия: **1.10.2**', 'Текущая версия: **1.10.3**');

const changelog = read('CHANGELOG.md');
const marker = '# Changelog\n\n';
if (!changelog.startsWith(marker)) throw new Error('CHANGELOG.md: header changed');
const section = `## 1.10.3 — 2026-09-04\n\n- Исправлена каскадная локализация дублей: если пропуск одной конфликтующей Excel-строки возвращает исходную строку TESSA и тем самым открывает следующий дубль, Studio повторяет проверку до устойчивого состояния. Конфликтующие строки переводятся в «Пропустить», а независимые корректные операции остаются доступными для Apply.\n- Та же логика применяется после ручного review: исключение строки или отдельного поля больше не превращает локально возникший дубль в глобальную блокировку всего пакета. Конфликт, который нельзя однозначно связать с изменяемой Excel-строкой, по-прежнему блокируется fail-closed.\n- После «Проверить изменения» доступен ручной «Скачать результат»: JSON \`TESSA_MATRIX_PREVIEW_REPORT_V1\` содержит итоговый reviewed-план, пропущенные строки и поля, выбранные исключения и текущую доступность Apply. Отчёт обновляется при изменении review и не выполняет запись в TESSA.\n- Серверная ValidateDuplicate перед Apply и повторная проверка перед Store сохранены. Ошибка интервалов LeftOperandExtractor этим релизом не объявляется исправленной.\n\n`;
write('CHANGELOG.md', marker + section + changelog.slice(marker.length));

for (const path of ['.github/workflows/temporary-v1.10.3-release-patch.yml', 'tools/temporary-v1.10.3-release-patch.mjs']) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('v1.10.3 release metadata patched and temporary patcher removed');
