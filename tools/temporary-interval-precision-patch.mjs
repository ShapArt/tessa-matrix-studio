import fs from 'node:fs';

const file = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(file, 'utf8');

const before = `      const hasFrom = Object.prototype.hasOwnProperty.call(data, F.IntValue);\n      const hasTo = Object.prototype.hasOwnProperty.call(data, F.IntToValue);\n      if (!hasFrom && !hasTo) continue;`;
const after = `      const storageValue = value => {\n        if (value && typeof value === 'object') {\n          if (Object.prototype.hasOwnProperty.call(value, '$__value')) return value.$__value;\n          if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;\n        }\n        return value;\n      };\n      const present = value => {\n        const scalar = storageValue(value);\n        return scalar !== null && scalar !== undefined && scalar !== '';\n      };\n      const isIntInterval = present(data[F.IntValue]) && present(data[F.IntToValue]);\n      const isDecimalInterval = present(data[F.DecimalValue]) && present(data[F.DecimalToValue]);\n      if (!isIntInterval && !isDecimalInterval) continue;`;

const index = code.indexOf(before);
if (index < 0) throw new Error('interval precision source block not found');
if (code.indexOf(before, index + before.length) >= 0) throw new Error('interval precision source block is not unique');
code = code.replace(before, after);
fs.writeFileSync(file, code);

for (const path of [
  '.github/workflows/temporary-interval-precision-patch.yml',
  'tools/temporary-interval-precision-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log('patched precise interval-row classification');
