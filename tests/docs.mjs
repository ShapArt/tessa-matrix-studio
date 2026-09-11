import fs from 'node:fs';

// Релизный контракт сверяет публичный README, changelog и issue-template с версией,
// которую реально получит пользователь из GitHub Release. Большой base userscript может
// оставаться на предыдущем patch, пока release.yml детерминированно собирает hotfix overlays.
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

const parseVersion = value => String(value || '').split('.').map(part => Number(part));
const isComposedPatchAhead = (next, base) => {
  const a = parseVersion(next);
  const b = parseVersion(base);
  return a.length === 3 && b.length === 3
    && a.every(Number.isInteger) && b.every(Number.isInteger)
    && a[0] === b[0] && a[1] === b[1] && a[2] > b[2];
};
const intervalOverlayExists = fs.existsSync(new URL('../hotfixes/interval-add-valid-fallback.js', import.meta.url));
const rangeTransformExists = fs.existsSync(new URL('../hotfixes/malformed-range-diagnostic-transform.mjs', import.meta.url));
if (publicVersion !== baseVersion) {
  assert(intervalOverlayExists, `base userscript ${baseVersion} differs from public release ${publicVersion} without interval composition`);
  assert(rangeTransformExists, `base userscript ${baseVersion} differs from public release ${publicVersion} without range transform`);
  assert(isComposedPatchAhead(publicVersion, baseVersion), `public release ${publicVersion} must be a later patch of base userscript ${baseVersion}`);
}

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

// Public screenshots must describe the current v1.13 UI, not retain stale pre-release captures.
for (const asset of [
  'docs/assets/studio-panel-v1.13.svg',
  'docs/assets/studio-picker-v1.13.svg',
  'docs/assets/studio-preview-v1.13.svg',
  'docs/assets/studio-uat-v1.13.svg',
]) {
  assert(readme.includes(asset), `README lost current UI screenshot: ${asset}`);
  assert(fs.existsSync(new URL(`../${asset}`, import.meta.url)), `README screenshot asset does not exist: ${asset}`);
}
assert(!readme.includes('docs/assets/studio-panel.webp'), 'README still references stale Studio panel screenshot');
assert(!readme.includes('docs/assets/studio-preview.webp'), 'README still references stale Preview screenshot');

assert(readme.includes('Tampermonkey → Dashboard / Панель управления'), 'README lost Tampermonkey Dashboard fallback');
assert(readme.includes('Utilities / Сервис'), 'README lost Tampermonkey Utilities fallback');
assert(readme.includes('В разделе **URL** вставьте:'), 'README lost manual URL import field');

assert(readme.includes('CHANGELOG.md') && readme.includes('docs/PRODUCTION-RUNBOOK.md'), 'README must link to deep technical safety documentation');
assert(changelog.includes('baseline-ledger') || runbook.includes('Roundtrip V6'), 'deep docs must explain the V6 baseline safety model');
assert(!readme.includes('# Боевой UAT перед раздачей пользователям'), 'public README must not contain the internal pre-release UAT block');
assert(!readme.includes('Стоп-критерии'), 'public README must not contain the removed UAT stop-criteria block');

assert(bugTemplate.includes(`placeholder: ${publicVersion}`), 'bug report version placeholder is out of sync');
assert(bugTemplate.includes('Счётчики preview'), 'bug report lost preview counters field');
assert(bugTemplate.includes('свежей выгрузке'), 'bug report lost fresh-export safety reminder');

console.log('TESSA Matrix Studio documentation checks: OK');
