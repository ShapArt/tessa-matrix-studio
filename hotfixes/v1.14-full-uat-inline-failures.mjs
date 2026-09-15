import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

// Live UAT on seeds 29768023 and 1346937433 both returned 29 PASS / 4 FAIL.
// The ZIP already contains failure evidence, but diagnosis must not depend on ZIP extraction.
// Render the exact failed check IDs/details in the panel and emit a tiny standalone text file.
const before = "      try { const result = await runFullUat({ liveConfirmation: 'full-uat-confirmed' }); status.dataset.state = result.status; status.textContent = `" +
  "${result.status} · PASS ${result.summary?.pass || 0} · FAIL ${result.summary?.fail || 0} · NOT RUN ${result.summary?.notRun || 0}\\n" +
  "Итоговый ZIP скачан. Seed: ${result.seed}`; }";

const after = `      try {
        // FULL_UAT_INLINE_FAILURES_V1
        const result = await runFullUat({ liveConfirmation: 'full-uat-confirmed' });
        status.dataset.state = result.status;
        const failures = Array.isArray(result.failedChecks)
          ? result.failedChecks
          : (result.checks || []).filter(check => check?.status === 'FAIL').map(check => ({ id: check.id, title: check.title, detail: check.detail }));
        const nl = String.fromCharCode(10);
        const failureText = failures.map((check, index) =>
          String(index + 1) + '. ' + String(check?.id || 'unknown') + ' — ' + String(check?.title || '') + nl + String(check?.detail || '')
        ).join(nl + nl);
        const header = String(result.status) + ' · PASS ' + String(result.summary?.pass || 0) + ' · FAIL ' + String(result.summary?.fail || 0) + ' · NOT RUN ' + String(result.summary?.notRun || 0)
          + nl + 'Итоговый ZIP скачан. Seed: ' + String(result.seed);
        status.textContent = header + (failureText ? nl + nl + 'FAIL DETAILS' + nl + failureText : '');
        if (failureText && E && typeof E.triggerBlobDownload === 'function') {
          E.triggerBlobDownload(
            new Blob([failureText], { type: 'text/plain;charset=utf-8' }),
            'TESSA_Full_UAT_FAILURES_' + String(result.seed || 'unknown') + '.txt',
          );
        }
      }`;

replaceExact(before, after, 'Full UAT inline failure UI');

for (const marker of [
  'FULL_UAT_INLINE_FAILURES_V1',
  'result.failedChecks',
  'FAIL DETAILS',
  'TESSA_Full_UAT_FAILURES_',
]) {
  if (!source.includes(marker)) throw new Error(`Full UAT inline failure verification failed: ${marker}`);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14 Full UAT inline failure UX: OK');
