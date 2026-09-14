import fs from 'node:fs';
import assert from 'node:assert/strict';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const communicationPath = new URL('../docs/communications/v1.14-colleague-test-message.md', import.meta.url);

assert.equal(pkg.version, '1.14.0', 'package candidate version must be 1.14.0');
assert.match(source, /^\/\/ @version\s+1\.14\.0$/m, 'userscript metadata version must be 1.14.0');
assert.match(source, /version:\s*'1\.14\.0'/, 'runtime version must be 1.14.0');

assert.match(source, /__TMS_FULL_UAT_V1__/, 'canonical userscript must ship the Full UAT runner');
assert.match(source, /Запустить полный UAT/, 'canonical userscript must expose the Full UAT action');
assert.match(source, /runFullUat/, 'canonical userscript must contain the Full UAT implementation');

assert.match(changelog, /## 1\.14\.0 — 2026-09-11/);
for (const token of ['session', 'touched', 'ФИО', 'Скачать изменения в Excel', 'Performance UAT']) {
  assert.ok(changelog.includes(token), `CHANGELOG must mention ${token}`);
}
assert.match(changelog, /synthetic/i, 'CHANGELOG must distinguish synthetic measurements');
assert.match(changelog, /live TESSA/i, 'CHANGELOG must state live TESSA is still required');

assert.ok(fs.existsSync(communicationPath), 'colleague UAT message must exist');
const communication = fs.readFileSync(communicationPath, 'utf8');
for (const token of ['0 изменений', 'ADD', 'UPDATE', 'DELETE', '3000', 'Скачать изменения в Excel', 'пакет диагностики']) {
  assert.ok(communication.includes(token), `colleague message must mention ${token}`);
}
assert.match(communication, /не.*подтвержден.*live TESSA/is, 'message must not claim live speedup before live UAT');
assert.match(communication, /1\.14\.0/);

assert.match(readme, /version-1\.14\.0/);
assert.match(readme, /\*\*v1\.14\.0/);
assert.ok(readme.includes('docs/assets/studio-panel.webp'), 'real README screenshot must be preserved');
assert.ok(readme.includes('Скачать изменения в Excel'), 'README should mention reviewed-changes export');

console.log('TESSA Matrix Studio v1.14 RC documentation/version contract: OK');
