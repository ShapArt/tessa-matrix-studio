import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCandidate } from '../tools/build-candidate.mjs';

// Kept under its historical filename so old CI entry points still execute the
// build contract. v1.17 replaces the hotfix chain with one deterministic build.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-canonical-build-'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

try {
  const productionA = path.join(temp, 'production-a.user.js');
  const productionB = path.join(temp, 'production-b.user.js');
  const uatA = path.join(temp, 'uat-a.user.js');
  const uatB = path.join(temp, 'uat-b.user.js');

  buildCandidate({ profile: 'production', out: productionA });
  buildCandidate({ profile: 'production', out: productionB });
  buildCandidate({ profile: 'uat', out: uatA });
  buildCandidate({ profile: 'uat', out: uatB });

  const production = fs.readFileSync(productionA);
  const uat = fs.readFileSync(uatA);
  assert.equal(sha256(production), sha256(fs.readFileSync(productionB)), 'production build must be deterministic');
  assert.equal(sha256(uat), sha256(fs.readFileSync(uatB)), 'UAT build must be deterministic');

  const productionSource = production.toString('utf8');
  const uatSource = uat.toString('utf8');
  for (const source of [productionSource, uatSource]) {
    assert.match(source, /^\/\/ @version\s+1\.17\.0$/m);
    assert.match(source, /version: '1\.17\.0'/);
    assert.match(source, /TESSA_MATRIX_ROUNDTRIP_V7/);
    assert.match(source, /TESSA_MATRIX_SUPPORT_BUNDLE_V1/);
    assert.match(source, /__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__/);
    assert.match(source, /MaxEntryUncompressedBytes:\s*128\s*\*\s*1024\s*\*\s*1024/);
    assert.match(source, /MaxTotalUncompressedBytes:\s*512\s*\*\s*1024\s*\*\s*1024/);
  }

  assert.doesNotMatch(productionSource, /__TESSA_MATRIX_SYNC_EXPORTS__/,
    'production must not publish internal test exports');
  assert.doesNotMatch(productionSource, /__TMS_FULL_UAT_V1__/,
    'production must not embed the destructive Full UAT runner');
  assert.match(uatSource, /__TESSA_MATRIX_SYNC_EXPORTS__/,
    'UAT candidate must expose the explicit test bridge');
  assert.match(uatSource, /__TMS_FULL_UAT_V1__/,
    'UAT candidate must include the Full UAT runner');
  assert.match(uatSource, /'action-support-bundle'/,
    'UAT action registry must verify the unified support package');

  for (const file of [productionA, uatA]) {
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr || `${file} failed syntax validation`);
  }

  console.log('TESSA Matrix Studio canonical build contract: OK');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
