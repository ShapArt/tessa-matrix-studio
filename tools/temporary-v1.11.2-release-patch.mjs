import fs from 'node:fs';

const from = '1.11.1';
const to = '1.11.2';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceExact(path, before, after, expected = 1) {
  let value = read(path);
  const count = value.split(before).length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} occurrence(s) of ${JSON.stringify(before)}, got ${count}`);
  value = value.split(before).join(after);
  write(path, value);
}

replaceExact('tessa-matrix-studio.user.js', `// @version      ${from}`, `// @version      ${to}`);
replaceExact('tessa-matrix-studio.user.js', `version: '${from}'`, `version: '${to}'`);

const pkg = JSON.parse(read('package.json'));
if (pkg.version !== from) throw new Error(`package.json version ${pkg.version} != ${from}`);
pkg.version = to;
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read('package-lock.json'));
if (lock.version !== from) throw new Error(`package-lock root version ${lock.version} != ${from}`);
if (lock.packages?.['']?.version !== from) throw new Error(`package-lock package version ${lock.packages?.['']?.version} != ${from}`);
lock.version = to;
lock.packages[''].version = to;
write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

let changelog = read('CHANGELOG.md');
if (!changelog.startsWith('# Changelog\n')) throw new Error('Unexpected CHANGELOG header');
if (changelog.includes(`## ${to} —`)) throw new Error(`${to} changelog already exists`);
const releaseNotes = `# Changelog\n\n## ${to} — 2026-09-05\n\n- Исправлена точность read-only interval probes: строки значений с \`IntValue/IntToValue = null\` больше не считаются интервалами только из-за наличия полей в storage; interval определяется только по реально заполненным обеим границам Int или Decimal диапазона.\n- Если \`saved-rebuilt\` проходит, а первый CardNew \`proposed-add\` и три точных interval-marker probe всё ещё отклоняются с \`duplicate-interval-extractor\`, диагностика последовательно проверяет version-row \`.changed\`, \`.state\`, оба маркера, затем маркеры неинтервальных value/role rows и, последним bounded вариантом, все row markers.\n- Более глубокие probes используют тот же captured CardNew payload и останавливаются, как только более узкий вариант перестаёт воспроизводить extractor failure. Дополнительные CardNew для probes не создаются.\n- Максимальный accepted-rebuilt путь с двумя candidates ограничен 12 duplicate-check запросами: 2 controls + 1 proposed-add + 8 detached probes + второй proposed-add baseline. Store/Delete не выполняются, \`writesAttempted = 0\`; Apply/Preflight/ValidateDuplicate не менялись.\n- Релиз остаётся диагностическим: \`LeftOperandExtractor is null\` не объявляется исправленным. Следующий live JSON должен показать, является ли триггером interval-row, version-row, non-interval/role markers или общий row-marker topology.\n`;
changelog = releaseNotes + changelog.slice('# Changelog\n'.length);
write('CHANGELOG.md', changelog);

replaceExact('README.md', `version-${from}-`, `version-${to}-`);
replaceExact('README.md', `**v${from} · Автор: Шаповалов Артём**`, `**v${to} · Автор: Шаповалов Артём**`);
replaceExact('README.md', `Подтвердите установку версии **${from}**`, `Подтвердите установку версии **${to}**`);
replaceExact('README.md', `Текущая версия: **${from}**`, `Текущая версия: **${to}**`);
replaceExact('.github/ISSUE_TEMPLATE/bug_report.yml', `placeholder: ${from}`, `placeholder: ${to}`);

for (const path of [
  '.github/workflows/temporary-v1.11.2-release-patch.yml',
  'tools/temporary-v1.11.2-release-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log(`prepared release ${to}`);
