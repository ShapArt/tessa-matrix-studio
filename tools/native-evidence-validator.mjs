import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const canonical = value => String(value ?? '').trim().toLowerCase();

function membershipKey(row) {
  return canonical(row?.rowRowID || row?.versionId || row?.sectionRowId || row?.rowID || '');
}

function membershipMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = membershipKey(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function validateNativeEvidence(report, options = {}) {
  const expectedOperation = String(options.expectedOperation || 'delete-save');
  const expectedRemovedCount = finiteNonNegative(options.expectedRemovedCount, 1);
  const reasonCodes = [];

  if (!report || typeof report !== 'object' || report.format !== 'TESSA_NATIVE_OPERATION_RECORD_V1') {
    return {
      status: 'invalid',
      expectedOperation,
      expectedRemovedCount,
      deleteVerified: false,
      saveObserved: false,
      restorationSafe: false,
      removedVersions: [],
      unexpectedAddedVersions: [],
      storeRecordCount: 0,
      truncatedCount: 0,
      reasonCodes: ['invalid-native-evidence-format'],
    };
  }

  const before = membershipMap(report.beforeMembership);
  const after = membershipMap(report.afterMembership);
  const removedVersions = [...before.keys()].filter(key => !after.has(key)).sort();
  const unexpectedAddedVersions = [...after.keys()].filter(key => !before.has(key)).sort();

  const records = Array.isArray(report.records) ? report.records : [];
  const successfulStores = records.filter(record =>
    canonical(record?.method) === 'store'
    && canonical(record?.outcome) === 'resolved'
    && record?.validationSuccessful !== false
  );
  const saveObserved = successfulStores.length > 0;
  const deleteVerified = removedVersions.length === expectedRemovedCount && unexpectedAddedVersions.length === 0;

  const restoration = report.restoration;
  const restorationSafe = Boolean(
    restoration
    && Number.isFinite(Number(restoration.failed))
    && Number(restoration.failed) === 0
  );
  const truncatedCount = finiteNonNegative(report.truncatedCount, 0);

  if (truncatedCount > 0) reasonCodes.push('recorder-truncated');
  if (!saveObserved) reasonCodes.push('store-not-observed');
  if (removedVersions.length !== expectedRemovedCount) reasonCodes.push('expected-delete-not-observed');
  if (unexpectedAddedVersions.length > 0) reasonCodes.push('unexpected-membership-add');
  if (!restorationSafe) reasonCodes.push('recorder-restore-failed');

  let status = 'verified';
  if (!restorationSafe) status = 'unsafe';
  else if (removedVersions.length !== expectedRemovedCount || unexpectedAddedVersions.length > 0) status = 'divergent';
  else if (truncatedCount > 0 || !saveObserved) status = 'incomplete';

  return {
    status,
    expectedOperation,
    expectedRemovedCount,
    deleteVerified,
    saveObserved,
    restorationSafe,
    removedVersions,
    unexpectedAddedVersions,
    storeRecordCount: successfulStores.length,
    truncatedCount,
    reasonCodes,
  };
}

function parseCli(argv) {
  const args = [...argv];
  const file = args.shift();
  let expectedOperation = 'delete-save';
  let expectedRemovedCount = 1;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--operation') expectedOperation = args.shift() || expectedOperation;
    else if (arg === '--removed') expectedRemovedCount = Number(args.shift());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!file) throw new Error('Usage: node tools/native-evidence-validator.mjs <TESSA_Native_Action.json> [--operation delete-save] [--removed 1]');
  return { file, expectedOperation, expectedRemovedCount };
}

function exitCode(status) {
  if (status === 'verified') return 0;
  if (status === 'incomplete') return 2;
  if (status === 'divergent') return 3;
  return 4;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try {
    const cli = parseCli(process.argv.slice(2));
    const report = JSON.parse(fs.readFileSync(path.resolve(cli.file), 'utf8'));
    const result = validateNativeEvidence(report, {
      expectedOperation: cli.expectedOperation,
      expectedRemovedCount: cli.expectedRemovedCount,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCode(result.status);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}
