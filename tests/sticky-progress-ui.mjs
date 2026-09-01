import fs from 'node:fs';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(/\.tms-body\{[^}]*overflow:auto/i.test(code), 'panel body must remain the scroll container');
const statusRule = code.match(/\.tms-status\{([^}]*)\}/i)?.[1] || '';
assert(/position\s*:\s*sticky/i.test(statusRule), `progress status must be sticky; rule=${statusRule}`);
assert(/top\s*:\s*0/i.test(statusRule), `sticky progress must pin to top:0; rule=${statusRule}`);
assert(/z-index\s*:\s*\d+/i.test(statusRule), `sticky progress needs z-index above scrolling content; rule=${statusRule}`);
assert(/background\s*:/i.test(statusRule), `sticky progress must remain readable over content; rule=${statusRule}`);

// Successful Apply should be rendered inline; blocking browser alert is reserved
// for actual unexpected errors rather than ordinary success.
assert(!/alert\(applyResultMessage\(result\)\)/.test(code), 'successful Apply must not use blocking alert()');
assert(/renderPlanConsumedNotice\(result\)/.test(code), 'post-Apply result must remain visible inline in Studio');

console.log('TESSA Matrix Studio sticky progress + inline Apply result UI contract: OK');
