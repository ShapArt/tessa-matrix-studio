import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const oldBlock = `    // Sparse row indexes are bounded above. Fill gaps so the rest of the existing\n    // roundtrip parser keeps its simple array contract without exposing holes.\n    for (let i = 0; i < rows.length; i += 1) rows[i] = rows[i] || [];\n    return { rows, maxCol };`;
const newBlock = `    // Keep missing rows as sparse-array holes. The numeric indexes are still bounded by\n    // MaxRowNumber, while avoiding one allocated empty Array for every absent row.\n    return { rows, maxCol };`;
const index = source.indexOf(oldBlock);
if (index < 0) throw new Error('sparse-row fill anchor not found');
if (source.indexOf(oldBlock, index + oldBlock.length) >= 0) throw new Error('sparse-row fill anchor not unique');
source = source.slice(0, index) + newBlock + source.slice(index + oldBlock.length);
fs.writeFileSync(path, source);
console.log('Kept SpreadsheetML row gaps sparse.');
