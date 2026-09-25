import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const names = relative => fs.readdirSync(path.join(root, relative), { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .sort();

assert.deepEqual(names('.github/workflows'), [
  'delivery-canary.yml',
  'live-excel-preview-uat-candidate.yml',
  'quality.yml',
  'release.yml',
  'uat-candidate.yml',
], 'active workflow set changed; document the new workflow or remove temporary automation');

assert.deepEqual(names('tools'), [
  'build-candidate.mjs',
  'build-enterprise-package.mjs',
  'create-full-uat-evidence-attestation.mjs',
  'create-native-evidence-attestation.mjs',
  'interval-repro-summary.mjs',
  'native-evidence-validator.mjs',
  'release-native-evidence-gate.mjs',
  'run-test-suite.mjs',
], 'tools must contain only active, documented entry points');

for (const removed of ['hotfixes', 'recovery', 'scripts']) {
  assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed}/ is historical and must not return to the active tree`);
}

const trackedGenerated = spawnSync('git', ['ls-files', '--error-unmatch', 'tessa-matrix-studio.user.js'], {
  cwd: root,
  stdio: 'ignore',
});
assert.notEqual(trackedGenerated.status, 0, 'generated root userscript must not be tracked');
assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/tessa-matrix-studio\.user\.js$/m);

const markdown = spawnSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' });
assert.equal(markdown.status, 0, markdown.stderr);
const missing = [];
for (const relative of markdown.stdout.split(/\r?\n/).filter(Boolean)) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    target = decodeURIComponent(target);
    if (!fs.existsSync(path.resolve(root, path.dirname(relative), target))) {
      missing.push(`${relative} -> ${match[1]}`);
    }
  }
}
assert.deepEqual(missing, [], `broken documentation links:\n${missing.join('\n')}`);

console.log('Repository hygiene: canonical tree, documented tools/workflows and Markdown links: OK');
