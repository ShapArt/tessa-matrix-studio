import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Compact status lives in the existing sticky progress area, not in a second modal/card.
assert(/id="tms-capability-status"/.test(code), 'capability status host is missing');
assert(/id="tms-capability-details"/.test(code), 'capability details host is missing');
assert(/id="tms-capability-recheck"/.test(code), 'capability recheck button is missing');
assert(/Повторить проверку/.test(code), 'capability recheck action must be human-readable');
assert(/\.tms-capability-row\{/.test(code), 'compact capability row CSS is missing');

// Session state must remember what was checked and invalidate naturally by card identity.
assert(/capabilities\s*:\s*null/.test(code), 'APP.capabilities is missing');
assert(/capabilityAvailability\s*:\s*null/.test(code), 'APP.capabilityAvailability is missing');
assert(/capabilityCheckedCardId\s*:\s*null/.test(code), 'APP.capabilityCheckedCardId is missing');

// Runtime gating must be operation-specific. Export/Analyze do not require ADD capability;
// Apply must evaluate the effective reviewed mutations rather than the original workbook.
assert(/requireRuntimeOperation\(['"]export['"]/.test(code), 'download path must capability-check export');
assert(/requireRuntimeOperation\(['"]analyze['"]/.test(code), 'analyze path must capability-check analyze');
assert(/requireRuntimeOperation\(['"]apply['"],\s*reviewedPlan\.actions/.test(code), 'Apply must capability-check effective reviewed actions');

// Load pure model in test mode.
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.capabilityStatusModel === 'function', 'capabilityStatusModel is missing');

const limited = E.capabilityStatusModel(
  { overall: 'limited', blockers: [], warnings: [{ code: 'native-view-refresh-unavailable', scope: 'refreshView' }] },
  {
    export: { enabled: true, blockers: [] },
    analyze: { enabled: true, blockers: [] },
    apply: { enabled: true, blockers: [] },
    refreshView: { enabled: false, blockers: ['native-view-refresh-unavailable'] },
    reconcile: { enabled: true, blockers: [] },
  },
);
assert(limited.label === 'Среда: ограничена', JSON.stringify(limited));
assert(limited.tone === 'limited', JSON.stringify(limited));
assert(limited.applyEnabled === true, JSON.stringify(limited));
assert(limited.exportEnabled === true && limited.analyzeEnabled === true, JSON.stringify(limited));
assert(limited.codes.includes('native-view-refresh-unavailable'), JSON.stringify(limited));
assert(!/\b\d{5,}\b/.test(limited.detail || ''), `UI detail leaked module-like numeric internals: ${limited.detail}`);

const incompatible = E.capabilityStatusModel(
  { overall: 'incompatible', blockers: [{ code: 'native-view-missing', scope: 'snapshot' }], warnings: [] },
  {
    export: { enabled: false, blockers: ['native-view-missing'] },
    analyze: { enabled: false, blockers: ['native-view-missing'] },
    apply: { enabled: false, blockers: ['native-view-missing'] },
    refreshView: { enabled: false, blockers: ['native-view-refresh-unavailable'] },
    reconcile: { enabled: false, blockers: ['native-view-missing'] },
  },
);
assert(incompatible.label === 'Среда: несовместима', JSON.stringify(incompatible));
assert(incompatible.tone === 'incompatible', JSON.stringify(incompatible));
assert(incompatible.applyEnabled === false, JSON.stringify(incompatible));
assert(/нативное представление|представление матрицы/i.test(incompatible.detail), JSON.stringify(incompatible));

console.log('TESSA Matrix Studio runtime capability UI contract: OK');
