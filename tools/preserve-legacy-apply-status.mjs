import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');
const before = "    result.matrixSaveIncomplete = Boolean(result.matrixSave && !result.matrixSave.ok && !result.matrixSave.skipped);";
const after = "    result.matrixSaveIncomplete = Boolean(result.matrixSave && !result.matrixSave.ok && !result.matrixSave.skipped && result.matrixSave.reason === 'matrix-save-failed');";
if (!code.includes(before)) throw new Error('matrixSaveIncomplete pattern not found');
code = code.replace(before, after);
fs.writeFileSync(file, code);
console.log('Preserved legacy Apply accounting when a synthetic bridge has no matrix-save capability');
