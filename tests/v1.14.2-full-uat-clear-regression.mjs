import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

assert.match(
  source,
  /FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2/,
  'Full UAT must deterministically exercise a real SET -> CLEAR cycle on a temporary row instead of returning NOT_RUN because a random source row has no provably optional filled criterion.',
);

assert.doesNotMatch(
  source,
  /if \(!\(book\.rows \|\| \[\]\)\.some\(row => canon\(rowIdentity\(book, row\)\.rowCardId\) !== canon\(rowCardId\) && !String\(row\.values\[index\] \|\| ''\)\.trim\(\)\)\) continue;/,
  'The flaky heuristic "another existing row is blank in this column" must not decide whether the live CLEAR scenario can run.',
);

assert.match(
  source,
  /write-clear-delete[\s\S]{0,12000}SET[\s\S]{0,12000}CLEAR[\s\S]{0,12000}cleanup/i,
  'The live clear scenario must prove SET, then CLEAR, then cleanup on the temporary row.',
);

console.log('TESSA Matrix Studio v1.14.2 Full UAT deterministic CLEAR regression: OK');
