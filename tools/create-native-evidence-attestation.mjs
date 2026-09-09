import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNativeEvidencePair } from './native-evidence-validator.mjs';
import { makeNativeEvidenceAttestation } from './release-native-evidence-gate.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function createNativeEvidenceAttestation({
  version,
  userscriptSource,
  deleteReport,
  saveReport,
  deleteEvidenceBytes,
  saveEvidenceBytes,
}) {
  const validatedResult = validateNativeEvidencePair(deleteReport, saveReport);
  if (validatedResult.status !== 'verified') {
    throw new Error(`Native DELETE + SAVE evidence is not verified: ${validatedResult.status}; ${validatedResult.reasonCodes.join(', ')}`);
  }

  return makeNativeEvidenceAttestation({
    version,
    userscriptSource,
    validatedResult,
    deleteEvidenceSha256: sha256(deleteEvidenceBytes),
    saveEvidenceSha256: sha256(saveEvidenceBytes),
    capturedAt: deleteReport?.startedAt || null,
  });
}

function cli() {
  const [version, userscriptPath, deleteEvidencePath, saveEvidencePath, outputPath] = process.argv.slice(2);
  if (!version || !userscriptPath || !deleteEvidencePath || !saveEvidencePath) {
    throw new Error('Usage: node tools/create-native-evidence-attestation.mjs <version> <userscript> <delete.json> <save.json> [output.json]');
  }

  const userscriptSource = fs.readFileSync(path.resolve(userscriptPath), 'utf8');
  const deleteEvidenceBytes = fs.readFileSync(path.resolve(deleteEvidencePath));
  const saveEvidenceBytes = fs.readFileSync(path.resolve(saveEvidencePath));
  const deleteReport = JSON.parse(deleteEvidenceBytes.toString('utf8'));
  const saveReport = JSON.parse(saveEvidenceBytes.toString('utf8'));

  const attestation = createNativeEvidenceAttestation({
    version,
    userscriptSource,
    deleteReport,
    saveReport,
    deleteEvidenceBytes,
    saveEvidenceBytes,
  });

  const text = `${JSON.stringify(attestation, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), text);
    process.stdout.write(`${path.resolve(outputPath)}\n`);
  } else {
    process.stdout.write(text);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try { cli(); }
  catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
