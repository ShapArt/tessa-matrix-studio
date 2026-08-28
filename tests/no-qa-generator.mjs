import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const script = read('tessa-matrix-studio.user.js');
const readme = read('README.md');
const issue = read('.github/ISSUE_TEMPLATE/bug_report.yml');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const token of ['Скачать QA-набор', 'buildQaPackVariants', 'downloadQaPack', 'README_QA.md', 'QA_PACK_MANIFEST.json', '00_QA_SMOKE_PREVIEW.xlsx']) {
  assert(!script.includes(token), `userscript still contains removed QA generator token: ${token}`);
  assert(!readme.includes(token), `README still contains removed QA generator token: ${token}`);
}
assert(!issue.includes('Скачать QA-набор'), 'issue template still exposes removed QA generator scenario');
assert(readme.includes('# Боевой UAT перед раздачей пользователям'), 'manual UAT checklist must remain in README');
assert(readme.includes('baseline-ledger'), 'Roundtrip V6 baseline safety documentation must remain');

console.log('TESSA Matrix Studio built-in QA generator removal contract: OK');
