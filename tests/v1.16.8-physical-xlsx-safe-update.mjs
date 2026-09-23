import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Seed 12305267 selected Excel row 75. The in-memory candidate was safe, but after the
// UAT physically patched/re-read the XLSX, planner role-validation saw zero resulting
// roles. UAT must choose candidates by the exact physical edit path it claims to test.
assert.match(source, /findPhysicalSafeUpdateCandidate/);
assert.match(source, /patchWorkbookVisibleCellForUat/);
assert.match(source, /physicalPlan\.counts\?\.update\s*\|\|\s*0/);
assert.match(source, /resultingRoleCountForAction/);
assert.match(source, /physical-safe-update/);
assert.doesNotMatch(source, /const edited = findSafeUpdateCandidate\(base\.book, structure, baseline, bridge, catalog, rng\);\s*const visibleValue/s);

console.log('v1.16.8 physical XLSX UAT candidate contract: PASS');
