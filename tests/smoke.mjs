import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const hotfixPath = new URL('../hotfixes/interval-add-valid-fallback.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parseVersion = value => String(value || '').split('.').map(part => Number(part));
const isOnePatchAhead = (next, base) => {
  const a = parseVersion(next);
  const b = parseVersion(base);
  return a.length === 3 && b.length === 3
    && a.every(Number.isInteger) && b.every(Number.isInteger)
    && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] + 1;
};

// Metadata checks protect the public installation/update path.
const metadataVersion = code.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
assert(metadataVersion, 'userscript @version metadata is missing');

// Emergency runtime overlays are composed only in the release artifact. When one is
// present, package.json may be exactly one patch ahead of the frozen base userscript;
// the release workflow must rewrite BOTH public metadata and APP.version before append.
if (metadataVersion !== pkg.version) {
  assert(fs.existsSync(hotfixPath), `userscript version ${metadataVersion} differs from package ${pkg.version} without a runtime overlay`);
  assert(isOnePatchAhead(pkg.version, metadataVersion), `overlay release ${pkg.version} must be exactly one patch ahead of base userscript ${metadataVersion}`);
} else {
  assert(metadataVersion === pkg.version, `userscript version ${metadataVersion} must match package version ${pkg.version}`);
}

assert(code.includes('// @author       Шаповалов Артём'), 'wrong author');
assert(code.includes('// @match        https://tessa.cherkizovsky.net/*'), 'main TESSA domain is missing');
const latestMetaUrl = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js';
const latestScriptUrl = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js';
assert(code.includes(`// @updateURL    ${latestMetaUrl}`), 'Tampermonkey updateURL must use the lightweight latest-release metadata asset');
assert(code.includes(`// @downloadURL  ${latestScriptUrl}`), 'Tampermonkey downloadURL must use the full latest-release userscript asset');
assert(!code.includes('cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'), 'stale jsDelivr @main update path must not remain in userscript metadata');

// Internal runtime diagnostics of the BASE source must report that source version.
// Composed overlay releases are separately verified by release.yml after APP.version rewrite.
assert(code.includes(`version: '${metadataVersion}',`), `APP.version is out of sync with userscript metadata ${metadataVersion}`);

// Load in test mode: bootstrap must not require a live TESSA page.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(E, 'test exports unavailable');
assert(E.normalizeSpace('  A   B  ') === 'A B', 'normalizeSpace regression');
assert(E.booleanSemantic('Да') === true, 'boolean Да regression');
assert(E.booleanSemantic('Нет') === false, 'boolean Нет regression');
assert(Array.isArray(E.splitCell('A\nB')) && E.splitCell('A\nB').length === 2, 'multi-value cell regression');

console.log('TESSA Matrix Studio smoke tests: OK');
