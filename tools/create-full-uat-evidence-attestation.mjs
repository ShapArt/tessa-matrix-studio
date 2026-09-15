import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFullUatNativeEvidenceAttestation } from './release-native-evidence-gate.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function createFullUatEvidenceAttestation({
  version,
  userscriptSource,
  uatReport,
  nativeTrace,
  uatEvidenceBytes,
  nativeTraceBytes,
}) {
  const uatBytes = Buffer.isBuffer(uatEvidenceBytes)
    ? uatEvidenceBytes
    : Buffer.from(uatEvidenceBytes ?? JSON.stringify(uatReport));
  const traceBytes = Buffer.isBuffer(nativeTraceBytes)
    ? nativeTraceBytes
    : Buffer.from(nativeTraceBytes ?? JSON.stringify(nativeTrace));

  return makeFullUatNativeEvidenceAttestation({
    version,
    userscriptSource,
    uatReport,
    nativeTrace,
    uatEvidenceSha256: sha256(uatBytes),
    nativeTraceSha256: sha256(traceBytes),
  });
}

function cli() {
  const [version, userscriptPath, uatReportPath, nativeTracePath, outputPath] = process.argv.slice(2);
  if (!version || !userscriptPath || !uatReportPath || !nativeTracePath) {
    throw new Error('Usage: node tools/create-full-uat-evidence-attestation.mjs <version> <userscript> <uat-report.json> <native-write-trace.json> [output.json]');
  }

  const userscriptSource = fs.readFileSync(path.resolve(userscriptPath), 'utf8');
  const uatEvidenceBytes = fs.readFileSync(path.resolve(uatReportPath));
  const nativeTraceBytes = fs.readFileSync(path.resolve(nativeTracePath));
  const uatReport = JSON.parse(uatEvidenceBytes.toString('utf8'));
  const nativeTrace = JSON.parse(nativeTraceBytes.toString('utf8'));

  const attestation = createFullUatEvidenceAttestation({
    version,
    userscriptSource,
    uatReport,
    nativeTrace,
    uatEvidenceBytes,
    nativeTraceBytes,
  });
  const json = `${JSON.stringify(attestation, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, json, 'utf8');
  } else {
    process.stdout.write(json);
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
