import fs from 'node:fs';
import assert from 'node:assert/strict';

const target = process.env.TMS_TEST_SOURCE || 'tessa-matrix-studio.user.js';
const source = fs.readFileSync(target, 'utf8');

assert.match(source, /FULL_UAT_RUNTIME_CONTEXT_V1/,
  'composed Full UAT must pin Apply to the fresh bridge/structure used to build its plan');
assert.match(source, /runtimeBridge:\s*bridge/,
  'Full UAT applySingle must pass the fresh runtime bridge into applyPlan');
assert.match(source, /runtimeStructure:\s*structure/,
  'Full UAT applySingle must pass the matching structure into applyPlan');
assert.match(source, /preflightPlan\(plan,\s*\{[\s\S]{0,300}bridge:\s*options\.runtimeBridge[\s\S]{0,300}structure:\s*options\.runtimeStructure/,
  'applyPlan must forward scoped runtime context into preflight');

console.log('Full UAT scoped runtime context contract: OK');
