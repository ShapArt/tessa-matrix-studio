import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.classifyIntervalDiagnosticError === 'function', 'classifyIntervalDiagnosticError export is required');
const error = new Error('Ошибка проверки дубликатов: Error: LeftOperandExtractor is null for Операнд являющийся значением хранящимся в настройке типа Decimal ... Интервал ... Равенство');
const classified = E.classifyIntervalDiagnosticError(error);
assert(classified.code === 'duplicate-interval-extractor', JSON.stringify(classified));
assert(classified.capability === 'unsupported-server-contract', JSON.stringify(classified));
assert(classified.fatal === false, 'known interval extractor defect must not crash the whole diagnostics run');
console.log('Interval duplicate diagnostics classify known server extractor limitation: OK');
