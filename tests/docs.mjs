import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const script = read('tessa-matrix-studio.user.js');
const readme = read('README.md');
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
assert(readme.includes(`Текущая версия: **${version}**`), 'README support version is out of sync');
assert(readme.includes(downloadUrl), 'README does not contain userscript download URL');
assert(downloadUrl === updateUrl, 'download/update URLs unexpectedly differ');
assert(readme.includes('docs/assets/studio-panel.webp'), 'README lost real Studio panel screenshot');
assert(readme.includes('docs/assets/excel-real.webp'), 'README lost real Excel screenshot');
assert(readme.includes('docs/assets/studio-preview.webp'), 'README lost real preview screenshot');
assert(readme.includes('Dashboard → Utilities → URL'), 'README lost manual URL-import fallback');

console.log('TESSA Matrix Studio documentation checks: OK');
