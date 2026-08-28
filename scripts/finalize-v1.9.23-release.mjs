import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, label, before, after) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: anchor is not unique`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

let script = read('tessa-matrix-studio.user.js');
script = replaceOnce(script, 'userscript metadata version', '// @version      1.9.22', '// @version      1.9.23');
script = replaceOnce(script, 'APP version', "    version: '1.9.22',", "    version: '1.9.23',");
write('tessa-matrix-studio.user.js', script);

let pkg = read('package.json');
pkg = replaceOnce(pkg, 'package version', '"version": "1.9.22"', '"version": "1.9.23"');
write('package.json', pkg);

let readme = read('README.md');
readme = replaceOnce(readme, 'README badge', 'version-1.9.22-', 'version-1.9.23-');
readme = replaceOnce(readme, 'README header', '**v1.9.22 · Автор: Шаповалов Артём**', '**v1.9.23 · Автор: Шаповалов Артём**');
readme = replaceOnce(readme, 'README quick start', 'Подтвердите установку версии **1.9.22**', 'Подтвердите установку версии **1.9.23**');
readme = replaceOnce(readme, 'README install verification', '- **Версия:** `1.9.21`', '- **Версия:** `1.9.23`');
readme = replaceOnce(readme, 'README support version', 'Текущая версия: **1.9.22**', 'Текущая версия: **1.9.23**');
const safetyAnchor = 'Roundtrip V6 дополнительно хранит на veryHidden-листе **baseline-ledger** с исходными MatrixRowID, MatrixVersionID и BaseFingerprint. Он нужен для безопасной проверки физического DELETE и целостности файла: если служебная identity или fingerprint повреждены либо удаляемая строка успела измениться в TESSA, Studio отказывается угадывать и просит свежую выгрузку.\n';
const safetyBlock = `${safetyAnchor}\n> [!IMPORTANT]\n> Начиная с **v1.9.23**, выбранный XLSX сначала проходит fail-closed проверку ZIP/OPC-пакета и только затем попадает в Excel-парсер. Studio отклоняет ZIP64 и шифрованные архивы, небезопасные или дублирующиеся пути, повреждённые смещения, а также файлы, способные чрезмерно разрастись при распаковке. Защитные пределы: **32 МБ** на исходный XLSX, **256** ZIP-частей, **128 МБ** на одну распакованную часть, **256 МБ** суммарно и степень сжатия не более **100×**. При срабатывании защиты никакие строки не передаются в Preview/Apply.\n`;
readme = replaceOnce(readme, 'README XLSX safety note', safetyAnchor, safetyBlock);
write('README.md', readme);

let issue = read('.github/ISSUE_TEMPLATE/bug_report.yml');
issue = replaceOnce(issue, 'issue template version', 'placeholder: 1.9.22', 'placeholder: 1.9.23');
write('.github/ISSUE_TEMPLATE/bug_report.yml', issue);

let changelog = read('CHANGELOG.md');
const entry = `## 1.9.23 — 2026-08-28\n\n- XLSX теперь проходит fail-closed проверку ZIP/OPC-пакета до XML-парсинга: опасный или повреждённый архив не доходит до Preview и Apply;\n- добавлены ресурсные пределы: 32 МБ на исходный XLSX, 256 ZIP-частей, 128 МБ на одну распакованную часть, 256 МБ суммарно и степень сжатия не более 100×;\n- отклоняются ZIP64, шифрованные entries, небезопасные и дублирующиеся пути, многотомные архивы, неподдерживаемые методы сжатия и выходящие за границы ZIP-смещения;\n- DEFLATE распаковывается потоково с контролем фактически полученных байтов и фактической степени сжатия, поэтому ложный declared size не обходит лимиты;\n- synthetic security-regressions покрывают oversized input, ZIP bomb, ZIP64/encryption, path traversal, duplicate paths и повреждённые offsets; обычный Roundtrip V6 остаётся совместимым.\n\n`;
changelog = replaceOnce(changelog, 'CHANGELOG header', '# Changelog\n\n', `# Changelog\n\n${entry}`);
write('CHANGELOG.md', changelog);

console.log('Prepared v1.9.23 release metadata and documentation.');
