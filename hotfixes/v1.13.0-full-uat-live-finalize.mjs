import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

// The Full UAT button already asks for explicit consent once before any write. The live
// 2026-09-11 run proved that routing each temporary operation through the normal Apply
// dialog makes automation nondeterministic: two scenarios returned null while cleanup
// remained safe. Scope confirmation bypass to this runner only; ordinary Apply keeps UI.
replaceExact(
`      const result = await E.applyPlan(plan);`,
`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });`,
  'pre-approved Full UAT Apply',
);

if (!source.includes("E.applyPlan(plan, { confirm: () => true, source: 'full-uat' })")) {
  throw new Error('Full UAT confirmation patch verification failed.');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.13.0 Full UAT live finalize: OK');
