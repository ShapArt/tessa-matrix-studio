import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(packageJson.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package version: ${version || '(empty)'}`);

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const productionCleanup = `(() => {
  'use strict';
  // Production removes the narrow temporary bridge after the fallback installs.
  try { delete window.__TMS_RUNTIME_BRIDGE__; } catch (_) { window.__TMS_RUNTIME_BRIDGE__ = undefined; }
  try { delete window.__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__; } catch (_) { window.__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__ = undefined; }
})();`;

export function buildCandidate({ profile = 'production', out } = {}) {
  if (!['production', 'uat'].includes(profile)) throw new Error(`Unknown build profile: ${profile}`);
  let core = read('src/core.user.js').replaceAll('__TMS_VERSION__', version);
  if (core.includes('__TMS_VERSION__')) throw new Error('Version placeholder was not fully resolved.');
  let interval = read('src/runtime/interval-add-valid-fallback.js');
  if (profile === 'production') {
    const exportBlock = /  window\.__TESSA_MATRIX_SYNC_EXPORTS__ = \{[\s\S]*?\n  \};\n\n  bootstrap\(\);/;
    if (!exportBlock.test(core)) throw new Error('Unable to replace the UAT export block for production.');
    core = core.replace(exportBlock, '  window.__TMS_RUNTIME_BRIDGE__ = { TessaBridge };\n\n  bootstrap();');
    interval = interval.replace(
      'window.__TESSA_MATRIX_SYNC_EXPORTS__ || window.__TMS_RUNTIME_BRIDGE__',
      'window.__TMS_RUNTIME_BRIDGE__',
    );
  }
  const modules = [core];
  if (profile === 'uat') modules.push(read('src/uat/full-uat.js'));
  modules.push(interval);
  if (profile === 'production') modules.push(productionCleanup);
  const candidate = `${modules.join('\n\n')}\n`;
  const metadataVersion = candidate.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
  const runtimeVersion = candidate.match(/^\s+version: '([^']+)',$/m)?.[1];
  if (metadataVersion !== version || runtimeVersion !== version) {
    throw new Error(`Version mismatch: package=${version}, metadata=${metadataVersion}, runtime=${runtimeVersion}`);
  }
  const target = path.resolve(root, out || (profile === 'uat'
    ? 'dist/tessa-matrix-studio.uat.user.js'
    : 'dist/tessa-matrix-studio.user.js'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, candidate, 'utf8');
  return { target, profile, version, bytes: Buffer.byteLength(candidate) };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') result.profile = argv[++index];
    else if (arg === '--out') result.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildCandidate(parseArgs(process.argv.slice(2)));
  console.log(`Built ${result.profile} v${result.version}: ${result.target} (${result.bytes} bytes)`);
}
