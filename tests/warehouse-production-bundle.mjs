import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(root, 'tools', 'build-production-userscript.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-warehouse-bundle-'));
const output = path.join(tmp, 'tessa-matrix-studio.user.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(fs.existsSync(builder), 'production userscript builder is missing');

const build = spawnSync(process.execPath, [builder, '1.12.2', output], {
  cwd: root,
  encoding: 'utf8',
});
assert(
  build.status === 0,
  `production userscript build failed:\n${build.stdout || ''}\n${build.stderr || ''}`,
);
assert(fs.existsSync(output), 'production userscript output was not created');

const script = fs.readFileSync(output, 'utf8');
for (const marker of [
  '__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__',
  'Numeric ranges have an exact grammar',
  '__TMS_WAREHOUSE_V14_KERNEL__',
  '__TMS_WAREHOUSE_V14__',
]) {
  assert(script.includes(marker), `production userscript is missing marker: ${marker}`);
}

const syntax = spawnSync(process.execPath, ['--check', output], {
  cwd: root,
  encoding: 'utf8',
});
assert(
  syntax.status === 0,
  `composed production userscript failed syntax check:\n${syntax.stdout || ''}\n${syntax.stderr || ''}`,
);

console.log('Warehouse production bundle contract: OK');
