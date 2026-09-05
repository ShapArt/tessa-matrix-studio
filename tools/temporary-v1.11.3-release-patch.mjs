import fs from 'node:fs';

const OLD = '1.11.2';
const VERSION = '1.11.3';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(path, text, before, after) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${path}: expected text not found: ${before}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: expected text is not unique: ${before}`);
  return text.replace(before, after);
}

let script = read('tessa-matrix-studio.user.js');
script = replaceOnce('tessa-matrix-studio.user.js', script, `// @version      ${OLD}`, `// @version      ${VERSION}`);
script = replaceOnce('tessa-matrix-studio.user.js', script, `version: '${OLD}',`, `version: '${VERSION}',`);
write('tessa-matrix-studio.user.js', script);

const pkg = JSON.parse(read('package.json'));
if (pkg.version !== OLD) throw new Error(`package.json unexpected version ${pkg.version}`);
pkg.version = VERSION;
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read('package-lock.json'));
if (lock.version !== OLD || lock.packages?.['']?.version !== OLD) {
  throw new Error(`package-lock.json unexpected versions ${lock.version}/${lock.packages?.['']?.version}`);
}
lock.version = VERSION;
lock.packages[''].version = VERSION;
write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

let readme = read('README.md');
for (const [before, after] of [
  [`version-${OLD}-`, `version-${VERSION}-`],
  [`**v${OLD} · Автор: Шаповалов Артём**`, `**v${VERSION} · Автор: Шаповалов Артём**`],
  [`Подтвердите установку версии **${OLD}**`, `Подтвердите установку версии **${VERSION}**`],
  [`Текущая версия: **${OLD}**`, `Текущая версия: **${VERSION}**`],
]) readme = replaceOnce('README.md', readme, before, after);
write('README.md', readme);

let changelog = read('CHANGELOG.md');
const releaseEntry = `## ${VERSION} — 2026-09-05\n\n- Расширена read-only диагностика issue #57 ещё одним доказанным structural probe: после всех отклонённых interval/version/non-interval/all-row marker-проверок Studio повторяет duplicate-check того же CardNew payload без section-level \`.changed\` на \`MtxRouteMatrixRow\` (sample \`proposed-add-clear-main-section-changed\`). Старый live raw diagnostic показывал этот marker у CardNew и его отсутствие у native saved card.\n- Каждый отправленный duplicate-check sample теперь содержит privacy-safe \`identityTopology\`: наличие CardID, Card.Version, количество version/value/role rows, совпадение request version с version-row, счётчики OwnerRowID mismatch/missing, missing/duplicate RowID и row marker counts. Сырые GUID, ФИО, роли, названия критериев и бизнес-значения в summary не включаются.\n- Новый envelope probe меняет только detached-сериализацию запроса; TemplateID и остальные поля/строки не меняются, дополнительные CardNew не создаются. Максимум для одного candidate: 12 duplicate-check запросов; accepted-rebuilt + два candidates: 13.\n- Store/Delete не выполняются, \`writesAttempted = 0\`; Apply, preflight и серверный ValidateDuplicate не менялись. Релиз не объявляет \`LeftOperandExtractor is null\` исправленным — свежий live JSON нужен для классификации минимального trigger.\n\n`;
if (!changelog.startsWith('# Changelog\n\n')) throw new Error('CHANGELOG.md header changed');
changelog = `# Changelog\n\n${releaseEntry}${changelog.slice('# Changelog\n\n'.length)}`;
write('CHANGELOG.md', changelog);

let bug = read('.github/ISSUE_TEMPLATE/bug_report.yml');
bug = replaceOnce('.github/ISSUE_TEMPLATE/bug_report.yml', bug, `placeholder: ${OLD}`, `placeholder: ${VERSION}`);
write('.github/ISSUE_TEMPLATE/bug_report.yml', bug);

for (const path of [
  '.github/workflows/temporary-v1.11.3-release-patch.yml',
  'tools/temporary-v1.11.3-release-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log(`prepared v${VERSION} release metadata`);
