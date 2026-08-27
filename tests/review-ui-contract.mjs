import fs from 'node:fs';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(code.includes('review: createPlanReviewState()'), 'APP review state is missing');
assert(code.includes('APP.review = createPlanReviewState();'), 'review state must reset for a newly analyzed Excel');
assert(code.includes('const reviewed = buildReviewedPlan(plan, APP.review);'), 'preview counters must use the reviewed plan');
assert(code.includes('data-review-change'), 'per-change review control is missing');
assert(code.includes('data-review-row'), 'whole-row review control is missing');
assert(code.includes('Не применять'), 'per-change exclude action label is missing');
assert(code.includes('Не применять всю строку'), 'whole-row exclude action label is missing');
assert(code.includes('Вернуть все изменения строки'), 'whole-row restore label is missing');
assert(code.includes('buildReviewedPlan(APP.plan, APP.review)'), 'Apply must use the reviewed effective plan');
assert(code.includes('tms-diff-excluded'), 'excluded change visual state is missing');

console.log('TESSA Matrix Studio selective review UI contract: OK');
