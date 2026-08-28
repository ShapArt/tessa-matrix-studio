const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, got ${count}`);
  return text.replace(before, after);
}
function replaceRegexOnce(text, regex, after, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly 1 match, got ${matches.length}`);
  return text.replace(regex, after);
}

let script = read('tessa-matrix-studio.user.js');

// Release version.
script = replaceOnce(script, '// @version      1.9.18', '// @version      1.9.19', 'metadata version');
script = replaceOnce(script, "    version: '1.9.18',", "    version: '1.9.19',", 'runtime version');

// SpreadsheetML readers may legally use namespace-prefixed tags (x:sheet/x:row/x:c/x:v).
// Accept both prefixed and unprefixed XML instead of assuming Studio's own serializer shape.
script = replaceOnce(
  script,
  "for (const match of rels.matchAll(/<Relationship\\b([^>]*)\\/?\\s*>/gi)) {",
  "for (const match of rels.matchAll(/<(?:[A-Za-z_][\\w.-]*:)?Relationship\\b([^>]*)\\/?\\s*>/gi)) {",
  'relationship namespace parser'
);
script = replaceOnce(
  script,
  "for (const match of workbook.matchAll(/<sheet\\b([^>]*)\\/?\\s*>/gi)) {",
  "for (const match of workbook.matchAll(/<(?:[A-Za-z_][\\w.-]*:)?sheet\\b([^>]*)\\/?\\s*>/gi)) {",
  'sheet namespace parser'
);
script = replaceOnce(
  script,
  "for (const rowMatch of xml.matchAll(/<row\\b([^>]*)>([\\s\\S]*?)<\\/row>/gi)) {",
  "for (const rowMatch of xml.matchAll(/<(?:[A-Za-z_][\\w.-]*:)?row\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?row>/gi)) {",
  'row namespace parser'
);
script = replaceOnce(
  script,
  "const cellRegex = /<c\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/c>)/gi;",
  "const cellRegex = /<(?:[A-Za-z_][\\w.-]*:)?c\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?c>)/gi;",
  'cell namespace parser'
);
script = replaceOnce(
  script,
  "const inline = cellBody.match(/<is\\b[^>]*>([\\s\\S]*?)<\\/is>/i);",
  "const inline = cellBody.match(/<(?:[A-Za-z_][\\w.-]*:)?is\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?is>/i);",
  'inline string namespace parser'
);
script = replaceOnce(
  script,
  "if (inline) value = [...inline[1].matchAll(/<t\\b[^>]*>([\\s\\S]*?)<\\/t>/gi)].map(x => xmlDecode(x[1])).join('');",
  "if (inline) value = [...inline[1].matchAll(/<(?:[A-Za-z_][\\w.-]*:)?t\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?t>/gi)].map(x => xmlDecode(x[1])).join('');",
  'text namespace parser'
);
script = replaceOnce(
  script,
  "const v = cellBody.match(/<v\\b[^>]*>([\\s\\S]*?)<\\/v>/i);",
  "const v = cellBody.match(/<(?:[A-Za-z_][\\w.-]*:)?v\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?v>/i);",
  'value namespace parser'
);

// v1.9.18 dependency matching compared only columns present in Excel. For a supported stale
// schema, omitted current TESSA columns are preserved on UPDATE/REPLACE and therefore must be
// included in the resulting fingerprint used to bind UPDATE/ADD to a planned DELETE.
script = replaceOnce(
  script,
  "      const desiredFingerprint = canonicalValue(fingerprintFlat(action.excelRow.flat || {}));",
  "      const resultingFlat = action.type === 'update'\n        ? { ...(action.currentRow?.flat || {}), ...(action.excelRow.flat || {}) }\n        : (action.excelRow.flat || {});\n      const desiredFingerprint = canonicalValue(fingerprintFlat(resultingFlat));",
  'dependent delete resulting fingerprint'
);

// Remove the built-in QA generator completely. Roundtrip V6 baseline safety stays intact.
const qaStart = script.indexOf('  function qaDefinitionDescriptors(structure) {');
const qaEnd = script.indexOf('  function sanitizeFileName(value) {', qaStart);
if (qaStart < 0 || qaEnd < 0 || qaEnd <= qaStart) throw new Error('QA generator block boundaries not found');
script = script.slice(0, qaStart) + script.slice(qaEnd);

script = replaceRegexOnce(
  script,
  /<button id=\\"tms-download-qa\\" class=\\"tms-ghost\\">Скачать QA-набор<\\\/button>/,
  '',
  'QA UI button'
);
script = replaceRegexOnce(
  script,
  /<div class=\\"tms-step-caption\\">QA-набор строится из текущей матрицы и проверяет NOOP \/ PATCH \/ ADD \/ REPLACE \/ DELETE \/ SKIP\. Destructive-файлы применяйте только в тестовой матрице\.<\\\/div>/,
  '<div class=\\"tms-step-caption\\">Скачайте рабочий Excel или обновите справочники перед редактированием.</div>',
  'QA UI caption'
);
script = replaceRegexOnce(
  script,
  /\n    panel\.querySelector\('#tms-download-qa'\)\.addEventListener\('click', async \(\) => \{[\s\S]*?\n    \}\);/,
  '',
  'QA UI event handler'
);
script = replaceOnce(
  script,
  'buildRoundtripGrid, createRoundtripXlsxBytes, buildQaPackVariants, downloadQaPack, mergeWorkbookIntoCurrentSnapshot,',
  'buildRoundtripGrid, createRoundtripXlsxBytes, mergeWorkbookIntoCurrentSnapshot,',
  'QA test exports'
);
write('tessa-matrix-studio.user.js', script);

let readme = read('README.md');
readme = readme.replaceAll('1.9.18', '1.9.19');
readme = readme.split('\n').filter(line => !line.includes('| **Скачать QA-набор** |')).join('\n');
const qaReadme = /\n## QA-набор для проверки всех сценариев[\s\S]*?(?=\n# Боевой UAT перед раздачей пользователям)/;
if (!qaReadme.test(readme)) throw new Error('README QA section not found');
readme = readme.replace(qaReadme, '\n');
write('README.md', readme);

let issue = read('.github/ISSUE_TEMPLATE/bug_report.yml');
issue = issue.replaceAll('1.9.18', '1.9.19');
issue = issue.split('\n').filter(line => !line.includes('- Скачать QA-набор')).join('\n');
write('.github/ISSUE_TEMPLATE/bug_report.yml', issue);

let smoke = read('tests/smoke.mjs');
smoke = replaceOnce(smoke, "// @version      1.9.18", "// @version      1.9.19", 'smoke version');
write('tests/smoke.mjs', smoke);

let docs = read('tests/docs.mjs');
docs = docs.replace("\nassert(readme.includes('Скачать QA-набор'), 'README lost the matrix-bound QA pack workflow');\nassert(readme.includes('00_QA_SMOKE_PREVIEW.xlsx'), 'README lost the one-shot QA smoke workbook');", '');
write('tests/docs.mjs', docs);

let pkg = JSON.parse(read('package.json'));
pkg.version = '1.9.19';
pkg.description = 'TESSA Matrix Studio userscript regression and safety verification';
pkg.scripts.test = pkg.scripts.test.replace(' && node tests/qa-pack.mjs', '');
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

let changelog = read('CHANGELOG.md');
if (!changelog.includes('## 1.9.19 — 2026-08-28')) {
  const section = `# Changelog\n\n## 1.9.19 — 2026-08-28\n\n- XLSX parser принимает валидный SpreadsheetML с namespace-префиксами (например, x:sheet / x:row / x:c / x:v), поэтому файлы, сохранённые сторонними Excel-библиотеками, больше не теряют строку заголовков;\n- встроенный «Скачать QA-набор» удалён из Studio и README: тестирование остаётся ручным на контролируемом Excel без сериализации живых TESSA-объектов;\n- зависимость UPDATE/ADD → DELETE теперь считается по фактическому итоговому состоянию строки, включая значения текущей TESSA для колонок, отсутствующих в поддерживаемом устаревшем Excel;\n- сохранены Roundtrip V6 baseline-ledger, integrity/stale DELETE-защиты, ручной боевой UAT и release/delivery проверки.\n\n`;
  changelog = changelog.replace('# Changelog\n\n', section);
}
write('CHANGELOG.md', changelog);

if (fs.existsSync('tests/qa-pack.mjs')) fs.rmSync('tests/qa-pack.mjs');
console.log('v1.9.19 patch applied');
