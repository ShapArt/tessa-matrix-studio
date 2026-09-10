import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const before = `    if (!isWritableMatrixDraft(matrixInfo, stateLocalizer)) {\n      blockedReasons.push(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo, stateLocalizer)}». Изменения возможны только в черновике.\`);\n      suppressUnsafePreview = true;\n    }`;
const after = `    if (!isWritableMatrixDraft(matrixInfo, stateLocalizer)) {\n      // Non-draft state blocks every write, but it is still safe and useful to show\n      // the calculated read-only diff. Only file/context integrity failures suppress Preview.\n      blockedReasons.push(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo, stateLocalizer)}». Изменения возможны только в черновике.\`);\n    }`;
if (!source.includes(before)) throw new Error('active matrix safety block not found');
if (source.split(before).length !== 2) throw new Error('active matrix safety block is not unique');
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log('active read-only preview patch applied');
