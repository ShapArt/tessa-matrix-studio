import fs from 'node:fs';

// Релизный контракт сверяет публичный README, changelog, runbook и issue-template с фактической версией userscript.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const script = read('tessa-matrix-studio.user.js');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const runbook = read('docs/PRODUCTION-RUNBOOK.md');
const bugTemplate = read('.github/ISSUE_TEMPLATE/bug_report.yml');
const pkg = JSON.parse(read('package.json'));

const versionMatch = script.match(/^\/\/ @version\s+([^\s]+)$/m);
const downloadMatch = script.match(/^\/\/ @downloadURL\s+(\S+)$/m);
const updateMatch = script.match(/^\/\/ @updateURL\s+(\S+)$/m);

assert(versionMatch, 'userscript @version is missing');
assert(downloadMatch, 'userscript @downloadURL is missing');
assert(updateMatch, 'userscript @updateURL is missing');

const version = versionMatch[1];
const downloadUrl = downloadMatch[1];
const updateUrl = updateMatch[1];

assert(pkg.version === version, `package.json version ${pkg.version} != userscript ${version}`);
assert(readme.includes(`version-${version}-`), 'README version badge is out of sync');
assert(readme.includes(`**v${version} · Автор: Шаповалов Артём**`), 'README header version is out of sync');
assert(readme.includes(`Подтвердите установку версии **${version}**`), 'README quick-start install version is out of sync');
assert(readme.includes(`Текущая версия: **${version}**`), 'README support version is out of sync');
assert(changelog.includes(`## ${version} —`), 'CHANGELOG latest release entry is out of sync');
assert(readme.includes(downloadUrl), 'README does not contain userscript download URL');
assert(updateUrl !== downloadUrl, 'metadata update URL must stay separate from full userscript download URL');
assert(downloadUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js', 'userscript download must track latest GitHub Release');
assert(updateUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js', 'userscript update check must use latest metadata asset');
assert(readme.includes(updateUrl), 'README does not document metadata update URL');
assert(!readme.includes('cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'), 'README must not use stale jsDelivr @main install/update path');
assert(readme.includes('docs/assets/studio-panel.webp'), 'README lost real Studio panel screenshot');
assert(readme.includes('docs/assets/excel-real.webp'), 'README lost real Excel screenshot');
assert(readme.includes('docs/assets/studio-preview.webp'), 'README lost real preview screenshot');
assert(readme.includes('Tampermonkey → Dashboard / Панель управления'), 'README lost Tampermonkey Dashboard fallback');
assert(readme.includes('Utilities / Сервис'), 'README lost Tampermonkey Utilities fallback');
assert(readme.includes('В разделе **URL** вставьте:'), 'README lost manual URL import field');

assert(runbook.includes('baseline-ledger'), 'production runbook must explain the V6 baseline ledger used for DELETE/integrity safety');
assert(!readme.includes('# Боевой UAT перед раздачей пользователям'), 'public README must not contain the internal pre-release UAT block');
assert(!readme.includes('Стоп-критерии'), 'public README must not contain the removed UAT stop-criteria block');

assert(bugTemplate.includes(`placeholder: ${version}`), 'bug report version placeholder is out of sync');
assert(bugTemplate.includes('Счётчики preview'), 'bug report lost preview counters field');
assert(bugTemplate.includes('свежей выгрузке'), 'bug report lost fresh-export safety reminder');

console.log('TESSA Matrix Studio documentation checks: OK');
