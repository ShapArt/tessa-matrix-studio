import fs from 'node:fs';
const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');
const before = `      reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',\n      error: lastError?.message || String(lastError || ''),\n      startedAt,`;
const after = `      reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',\n      startedAt,`;
if (!code.includes(before)) throw new Error('technical reconciliation error field pattern not found');
code = code.replace(before, after);
fs.writeFileSync(file, code);
console.log('Removed technical reconciliation error from user-facing result');
