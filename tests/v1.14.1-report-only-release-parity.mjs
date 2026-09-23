import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { assertReleaseNativeEvidence } from '../tools/release-native-evidence-gate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-v1141-report-release-'));
const parentPath = path.join(tmp, 'parent-v1.14.0.user.js');
const candidatePath = path.join(tmp, 'candidate-v1.14.1.user.js');
const publicParentSha256 = '811a3e7251cc0f89f632814b3ac49d5feb1e280670f34f31c6a631b22d960eff';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return result;
};
const setVersion = (source, version) => String(source)
  .replace(/^\/\/ @version\s+[0-9.]+$/m, `// @version      ${version}`)
  .replace(/^(\s*)version:\s*'[0-9.]+'\s*,$/m, `$1version: '${version}',`);

try {
  fs.copyFileSync(path.join(root, 'tessa-matrix-studio.user.js'), parentPath);
  run(['hotfixes/malformed-range-diagnostic-transform.mjs', parentPath]);
  run(['hotfixes/v1.13.0-user-row-lifecycle-transform.mjs', parentPath]);
  fs.writeFileSync(parentPath, setVersion(fs.readFileSync(parentPath, 'utf8'), '1.14.0'));
  fs.appendFileSync(parentPath, `\n${fs.readFileSync(path.join(root, 'hotfixes/interval-add-valid-fallback.js'), 'utf8')}\n`);
  run(['hotfixes/v1.13.0-full-uat-live-finalize.mjs', parentPath]);
  run(['hotfixes/v1.14-full-uat-inline-failures.mjs', parentPath]);
  run(['hotfixes/v1.14-live-uat-final-four.mjs', parentPath]);
  run(['--check', parentPath]);

  const parentSource = fs.readFileSync(parentPath, 'utf8');
  assert.equal(sha256(parentSource), publicParentSha256,
    'repository composition must still reproduce the exact live-tested/public v1.14.0 userscript');

  fs.writeFileSync(candidatePath, setVersion(parentSource, '1.14.1'));
  run(['hotfixes/v1.14.1-changes-report-full-row.mjs', candidatePath]);
  run(['--check', candidatePath]);
  const candidateSource = fs.readFileSync(candidatePath, 'utf8');
  assert.match(candidateSource, /REVIEWED_CHANGES_REPORT_V3/);
  assert.match(candidateSource, /TESSA_MATRIX_CHANGES_REPORT_V3/);
  assert.match(candidateSource, /reportOnly:\s*true/);
  assert.doesNotMatch(candidateSource, /Детали изменений/);

  const attestationPath = path.join(root, 'release-evidence/v1.14.1.json');
  const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  const accepted = assertReleaseNativeEvidence({
    version: '1.14.1', userscriptSource: candidateSource, parentUserscriptSource: parentSource, attestation,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.schemaVersion, 4);
  assert.equal(accepted.operation, 'report-only-derivative');
  assert.equal(accepted.parentUserscriptSha256, publicParentSha256);

  // Exercise the exact CLI used by .github/workflows/release.yml. It rebuilds the parent
  // independently and must refuse the release if anything outside the report/version surface changed.
  const cli = run(['tools/release-native-evidence-gate.mjs', '1.14.1', candidatePath, attestationPath]);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.ok, true);
  assert.equal(cliResult.schemaVersion, 4);
  assert.equal(cliResult.operation, 'report-only-derivative');

  console.log('v1.14.1 report-only release parity: exact public v1.14.0 parent + bounded V3 report diff + release CLI gate OK');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
