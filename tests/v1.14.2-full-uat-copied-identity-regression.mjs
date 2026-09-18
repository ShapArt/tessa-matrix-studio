import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1/,
  'collision-safe copied-identity marker missing');

const start = source.indexOf("FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1");
const end = source.indexOf("dictionary-stale-companion", start);
assert.ok(start >= 0 && end > start, 'copied-identity UAT block not found');
const block = source.slice(start, end);

assert.match(block, /probePlan\.counts\.skip\s*===\s*0/);
assert.match(block, /probePlan\.counts\.add\s*===\s*3/);
assert.match(block, /probePlan\.counts\.update\s*===\s*1/);
assert.match(block, /probePlan\.counts\.delete\s*===\s*0/);
assert.match(block, /finalPlan\.counts\.delete\s*===\s*2/);
assert.match(block, /attemptLimit\s*=\s*240/);
assert.match(block, /business-дубл/);
assert.doesNotMatch(block, /const column = shuffled\(columns, rng\)\[0\], source = chooseSourceRow\(base\.book, rng\)/,
  'single-shot collision-prone copied-identity generator must be removed');

console.log('TESSA Matrix Studio copied-identity UAT collision-safe regression: OK');
