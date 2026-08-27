const fs = require('fs');
const path = 'tessa-matrix-studio.user.js';
let s = fs.readFileSync(path, 'utf8');
const qaBlock = fs.readFileSync('tools/qa-block-v1.9.15.txt', 'utf8');

function replaceOnce(from, to, label) {
  const count = s.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  s = s.replace(from, to);
}

replaceOnce(
`    const baselineRows = [['MatrixRowID', 'MatrixVersionID', 'BaseFingerprint']];
    for (const row of snapshot.rows || []) {
      baselineRows.push([row.rowCardId || '', row.versionId || '', row.fingerprint || fingerprintFlat(row.flat || {})]);
    }`,
`    const baselineRows = [['MatrixRowID', 'MatrixVersionID', 'BaseFingerprint']];
    const baselineSourceRows = Array.isArray(options.baselineRows) ? options.baselineRows : (snapshot.rows || []);
    for (const row of baselineSourceRows) {
      baselineRows.push([row.rowCardId || '', row.versionId || '', row.fingerprint || fingerprintFlat(row.flat || {})]);
    }`,
'baseline override');

replaceOnce(
`  function sanitizeFileName(value) {`,
`${qaBlock}  function sanitizeFileName(value) {`,
'QA implementation insertion');

replaceOnce(
`          <div class="tms-step"><div class="tms-step-label">1 · Подготовить Excel</div><div class="tms-row"><button id="tms-download-current" class="tms-primary">Скачать Excel</button><button id="tms-download-fresh">Скачать со свежими справочниками</button></div><div class="tms-step-caption">Обычная выгрузка быстрее. Свежие справочники нужны, если значения недавно добавили или переименовали.</div></div>`,
`          <div class="tms-step"><div class="tms-step-label">1 · Подготовить Excel</div><div class="tms-row"><button id="tms-download-current" class="tms-primary">Скачать Excel</button><button id="tms-download-fresh">Скачать со свежими справочниками</button><button id="tms-download-qa" class="tms-ghost">Скачать QA-набор</button></div><div class="tms-step-caption">QA-набор строится из текущей матрицы и проверяет NOOP / PATCH / ADD / REPLACE / DELETE / SKIP. Destructive-файлы применяйте только в тестовой матрице.</div></div>`,
'QA button');

replaceOnce(
`    panel.querySelector('#tms-refresh-excel').addEventListener('click', async () => {`,
`    panel.querySelector('#tms-download-qa').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { await downloadQaPack(); alert('QA-набор скачан. Начните с 00_QA_SMOKE_PREVIEW.xlsx. Destructive-сценарии применяйте только в тестовой матрице.'); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); alert(\`Не удалось создать QA-набор: \${message}\`); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-refresh-excel').addEventListener('click', async () => {`,
'QA click handler');

replaceOnce(
`    buildRoundtripGrid, createRoundtripXlsxBytes, mergeWorkbookIntoCurrentSnapshot, mergeWorkbookEditsIntoSnapshot, parseSchemaToken, normalizeAction, cherkizovoLogoSvg, issueExcelRows, makeSkippedRow,`,
`    buildRoundtripGrid, createRoundtripXlsxBytes, buildQaPackVariants, downloadQaPack, mergeWorkbookIntoCurrentSnapshot, mergeWorkbookEditsIntoSnapshot, parseSchemaToken, normalizeAction, cherkizovoLogoSvg, issueExcelRows, makeSkippedRow,`,
'QA exports');

fs.writeFileSync(path, s);
console.log('QA pack production patch applied.');
