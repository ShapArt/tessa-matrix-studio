import fs from 'node:fs';

function replaceExact(path, from, to, label) {
  let text = fs.readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  text = text.replace(from, to);
  fs.writeFileSync(path, text);
}

replaceExact(
  'tessa-matrix-studio.user.js',
  '// @version      1.9.17',
  '// @version      1.9.18',
  'userscript metadata version'
);
replaceExact(
  'tessa-matrix-studio.user.js',
  "    version: '1.9.17',",
  "    version: '1.9.18',",
  'runtime version'
);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== '1.9.17') throw new Error(`package version: expected 1.9.17, got ${pkg.version}`);
pkg.version = '1.9.18';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

replaceExact(
  'tests/smoke.mjs',
  "assert(code.includes('// @version      1.9.17'), 'wrong userscript version');",
  "assert(code.includes('// @version      1.9.18'), 'wrong userscript version');",
  'smoke expected version'
);

const readmePath = 'README.md';
let readme = fs.readFileSync(readmePath, 'utf8');
const readmeCount = readme.split('1.9.17').length - 1;
if (readmeCount !== 4) throw new Error(`README current-version occurrences: expected 4, got ${readmeCount}`);
readme = readme.replaceAll('1.9.17', '1.9.18');
fs.writeFileSync(readmePath, readme);

const changelogPath = 'CHANGELOG.md';
let changelog = fs.readFileSync(changelogPath, 'utf8');
const header = '# Changelog\n\n';
if (!changelog.startsWith(header)) throw new Error('CHANGELOG header missing');
const section = `## 1.9.18 — 2026-08-28\n\n- добавлена явная зависимость DELETE от UPDATE/ADD, когда новая итоговая строка занимает комбинацию удаляемой строки;\n- если связанный UPDATE/ADD не проходит preflight, зависимый DELETE тоже переводится в SKIP — существующая строка TESSA сохраняется;\n- зависимость повторно контролируется на реальной записи: если UPDATE/ADD падает после успешного preflight, связанный DELETE не выполняется отдельно;\n- добавлены два regression-сценария для destructive partial apply: preflight duplicate conflict и store-time failure в пакете UPDATE A → B + DELETE B.\n\n`;
if (changelog.includes('## 1.9.18 —')) throw new Error('CHANGELOG 1.9.18 already exists');
changelog = header + section + changelog.slice(header.length);
fs.writeFileSync(changelogPath, changelog);

console.log('v1.9.18 release metadata patch applied');
