import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Metadata checks protect the public installation/update path.
assert(code.includes('// @version      1.9.15'), 'wrong userscript version');
assert(code.includes('// @author       Шаповалов Артём'), 'wrong author');
assert(code.includes('// @match        https://tessa.cherkizovsky.net/*'), 'main TESSA domain is missing');
const latestMetaUrl = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js';
const latestScriptUrl = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js';
assert(code.includes(`// @updateURL    ${latestMetaUrl}`), 'Tampermonkey updateURL must use the lightweight latest-release metadata asset');
assert(code.includes(`// @downloadURL  ${latestScriptUrl}`), 'Tampermonkey downloadURL must use the full latest-release userscript asset');
assert(!code.includes('cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'), 'stale jsDelivr @main update path must not remain in userscript metadata');

// Internal runtime diagnostics must report the same version as userscript metadata.
const metadataVersion = code.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
assert(metadataVersion, 'userscript @version metadata is missing');
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
