import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(path, 'utf8');

const needle = `    const details = { workbookMatrixId, currentMatrixId, workbookTemplateId, currentTemplateId, previousMatrixId };\n    if (!workbook?.roundtrip?.enabled) return { kind: 'invalid-roundtrip', ...details };\n    if (!workbookTemplateId || !currentTemplateId || workbookTemplateId !== currentTemplateId) {`;
const replacement = `    const details = { workbookMatrixId, currentMatrixId, workbookTemplateId, currentTemplateId, previousMatrixId };\n    if (!workbook?.roundtrip?.enabled) return { kind: 'invalid-roundtrip', ...details };\n    // Cross-matrix replacement is destructive. Template equality alone is never\n    // sufficient evidence of source/target identity: both matrix IDs must exist.\n    if (!workbookMatrixId || !currentMatrixId) return { kind: 'invalid-roundtrip', ...details };\n    if (!workbookTemplateId || !currentTemplateId || workbookTemplateId !== currentTemplateId) {`;
if (!code.includes(needle)) throw new Error('matrix identity context marker not found');
code = code.replace(needle, replacement);
fs.writeFileSync(path, code);
console.log('cross-matrix identity context patch applied');
