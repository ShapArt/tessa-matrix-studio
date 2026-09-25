import fs from 'node:fs';

// Релизный контракт сверяет публичный README, changelog и issue-template с версией,
// которую реально получит пользователь из GitHub Release.
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

const baseVersion = versionMatch[1];
const publicVersion = pkg.version;
const downloadUrl = downloadMatch[1];
const updateUrl = updateMatch[1];

assert(publicVersion === baseVersion, `canonical userscript ${baseVersion} differs from package ${publicVersion}`);

assert(readme.includes(`version-${publicVersion}-`), 'README version badge is out of sync');
assert(readme.includes(`**v${publicVersion} · Автор: Шаповалов Артём**`), 'README header version is out of sync');
assert(readme.includes(`Подтвердите установку версии **${publicVersion}**`), 'README quick-start install version is out of sync');
assert(readme.includes(`Текущая версия: **${publicVersion}**`), 'README support version is out of sync');
assert(changelog.includes(`## ${publicVersion} —`), 'CHANGELOG latest release entry is out of sync');
assert(readme.includes(downloadUrl), 'README does not contain userscript download URL');
assert(updateUrl !== downloadUrl, 'metadata update URL must stay separate from full userscript download URL');
assert(downloadUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js', 'userscript download must track latest GitHub Release');
assert(updateUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js', 'userscript update check must use latest metadata asset');
assert(readme.includes(updateUrl), 'README does not document metadata update URL');
assert(!readme.includes('cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'), 'README must not use stale jsDelivr @main install/update path');
for (const prefix of ['studio-start', 'excel-matrix', 'studio-preview', 'studio-apply', 'changes-report']) {
  const asset = readme.match(new RegExp(`docs/assets/${prefix}-v[^"')]+\\.(?:jpg|png)`))?.[0];
  assert(asset && fs.existsSync(new URL(`../${asset}`, import.meta.url)), `README lost current ${prefix} screenshot`);
}
assert(readme.includes('Tampermonkey → Dashboard / Панель управления'), 'README lost Tampermonkey Dashboard fallback');
assert(readme.includes('Utilities / Сервис'), 'README lost Tampermonkey Utilities fallback');
assert(readme.includes('В разделе **URL** вставьте:'), 'README lost manual URL import field');

assert(readme.includes('CHANGELOG.md') && readme.includes('docs/PRODUCTION-RUNBOOK.md'), 'README must link to deep technical safety documentation');
assert(changelog.includes('baseline-ledger') || runbook.includes('Roundtrip V6') || runbook.includes('Roundtrip V7'), 'deep docs must explain the baseline safety model');
assert(!readme.includes('# Боевой UAT перед раздачей пользователям'), 'public README must not contain the internal pre-release UAT block');
assert(!readme.includes('Стоп-критерии'), 'public README must not contain the removed UAT stop-criteria block');

assert(bugTemplate.includes(`placeholder: ${publicVersion}`), 'bug report version placeholder is out of sync');
assert(bugTemplate.includes('Счётчики preview'), 'bug report lost preview counters field');
assert(bugTemplate.includes('свежей выгрузке'), 'bug report lost fresh-export safety reminder');

console.log('TESSA Matrix Studio documentation checks: OK');
