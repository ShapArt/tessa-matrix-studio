import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (source.includes('FULL_UAT_ACTION_COVERAGE_FINAL_V1')) {
  console.log('TESSA Matrix Studio v1.14.2 Full UAT action coverage final: already applied');
  process.exit(0);
}

const declarationNeedle = "    let cleanupUnsafe = false;";
if (!source.includes(declarationNeedle)) throw new Error('Full UAT cleanupUnsafe declaration anchor not found');
source = source.replace(
  declarationNeedle,
  declarationNeedle + "\n    // FULL_UAT_ACTION_COVERAGE_FINAL_V1\n    let reconciliationActionReceiptContext = null;"
);

const cleanupNeedle = "        bridge = current.bridge; const result = await applySingle(plan, `${scenarioId}: cleanup DELETE`);\n        const verified = await freshSnapshot();";
if (!source.includes(cleanupNeedle)) throw new Error('Full UAT cleanup DELETE anchor not found');
source = source.replace(
  cleanupNeedle,
  "        bridge = current.bridge; const result = await applySingle(plan, `${scenarioId}: cleanup DELETE`);\n"
  + "        // Preserve one real DELETE receipt so the Reconcile action can be exercised later\n"
  + "        // against the fully saved/restored matrix. This is real product reconciliation,\n"
  + "        // not a synthetic action-coverage checkbox.\n"
  + "        if (!reconciliationActionReceiptContext) {\n"
  + "          const deleteAction = deletes[0];\n"
  + "          const receipt = E.createMutationReceipt({\n"
  + "            type: 'delete', action: deleteAction,\n"
  + "            rowCardId: deleteAction.currentRow?.rowCardId,\n"
  + "            versionId: deleteAction.currentRow?.versionId,\n"
  + "            expectedRow: null, structure,\n"
  + "          });\n"
  + "          reconciliationActionReceiptContext = {\n"
  + "            matrixId: report.matrix?.matrixId,\n"
  + "            templateId: report.matrix?.templateId,\n"
  + "            receipts: [receipt],\n"
  + "          };\n"
  + "        }\n"
  + "        const verified = await freshSnapshot();"
);

const finalNeedle = "      try {\n        const packageProbe = await E.makeZip([...packageEntries, ['task8-package-probe.txt', utf8('TESSA Full UAT package probe')]]);";
if (!source.includes(finalNeedle)) throw new Error('Full UAT final package-probe anchor not found');

const evidenceBlock = `      // FULL_UAT_ACTION_COVERAGE_FINAL_V1
      // Apply evidence is based on the same audited live writes that the Full UAT just
      // executed. A PASS requires at least one accepted mutation and zero unfinished writes.
      {
        const applyOk = report.writesAttempted > 0
          && report.writesCompleted === report.writesAttempted
          && !report.checks.some(check => check.required !== false && check.status === 'FAIL' && /^write-/.test(String(check.id || '')));
        addCheck(
          'action-apply',
          'Действие: применить к TESSA',
          applyOk ? 'PASS' : 'FAIL',
          applyOk
            ? 'Реальные Apply-операции завершены и подтверждены server read-back/cleanup.'
            : ('Apply evidence неполный: attempted=' + report.writesAttempted + ', completed=' + report.writesCompleted + '.'),
          {
            required: true,
            data: {
              outcome: applyOk ? 'live-write-readback' : null,
              writesAttempted: report.writesAttempted,
              writesCompleted: report.writesCompleted,
            },
          },
        );
      }

      // Reconcile must be a real runReconciliationRead invocation. The retained receipt is
      // a successful DELETE of a temporary UAT row; after cleanup/final Save the correct
      // reconciliation result is "verified" with that row still absent.
      try {
        if (!reconciliationActionReceiptContext?.receipts?.length) {
          throw new Error('Нет подтверждённого DELETE receipt для Reconcile evidence.');
        }
        const reconciliationResult = await E.runReconciliationRead(
          async () => E.TessaBridge.create(),
          reconciliationActionReceiptContext,
          { attempts: 3, baseDelayMs: 100 },
        );
        const checked = Number(reconciliationResult?.checkedCount || 0);
        const verified = Number(reconciliationResult?.verifiedCount || 0);
        if (reconciliationResult?.status !== 'verified' || checked < 1 || verified !== checked) {
          throw new Error(
            'Reconcile не подтвердил receipt: status=' + String(reconciliationResult?.status || 'unknown')
            + ', checked=' + checked + ', verified=' + verified
            + ', missing=' + Number(reconciliationResult?.missingCount || 0)
            + ', divergent=' + Number(reconciliationResult?.divergentCount || 0) + '.',
          );
        }
        addCheck(
          'action-reconcile',
          'Действие: сверить результат',
          'PASS',
          'Reconcile реально перечитал TESSA по mutation receipt и подтвердил итог.',
          {
            required: true,
            data: {
              outcome: 'reconciliation-readback',
              status: reconciliationResult.status,
              mode: reconciliationResult.mode || null,
              checkedCount: checked,
              verifiedCount: verified,
              attempts: reconciliationResult.attempts || 1,
            },
          },
        );
      } catch (reconcileError) {
        addCheck(
          'action-reconcile',
          'Действие: сверить результат',
          'FAIL',
          String(reconcileError?.message || reconcileError),
          { required: true, data: { outcome: null } },
        );
      }

`;

source = source.replace(finalNeedle, evidenceBlock + finalNeedle);

if (!source.includes("addCheck(\n          'action-apply'")) throw new Error('Apply action evidence not inserted');
if (!source.includes("addCheck(\n          'action-reconcile'")) throw new Error('Reconcile action evidence not inserted');
if (!source.includes('await E.runReconciliationRead(')) throw new Error('Real Reconcile invocation not inserted');
if (!source.includes('E.createMutationReceipt({')) throw new Error('Mutation receipt evidence not inserted');

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14.2 Full UAT action coverage final: OK');