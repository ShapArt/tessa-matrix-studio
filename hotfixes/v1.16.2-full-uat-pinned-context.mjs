import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (source.includes('FULL_UAT_PINNED_CONTEXT_RECOVERY_V1')) {
  console.log('TESSA Matrix Studio v1.16.2 Full UAT pinned-context recovery: already applied');
  process.exit(0);
}

function replaceOnce(regex, replacement, label) {
  const matches = source.match(regex);
  if (!matches || matches.length !== 1) {
    throw new Error(label + ': expected exactly one match, got ' + (matches ? matches.length : 0));
  }
  source = source.replace(regex, replacement);
}

replaceOnce(
  /    \/\/ FULL_UAT_ACTION_COVERAGE_FINAL_V1\n    let reconciliationActionReceiptContext = null;/g,
  [
    '    // FULL_UAT_ACTION_COVERAGE_FINAL_V1',
    '    let reconciliationActionReceiptContext = null;',
    '    // FULL_UAT_PINNED_CONTEXT_RECOVERY_V1',
    '    let pinnedUatBridge = null;',
    "    let pinnedUatMatrixId = '';",
    "    let pinnedUatTemplateId = '';",
  ].join('\n'),
  'pinned UAT context declaration',
);

replaceOnce(
  /    async function freshSnapshot\(\) \{\n      const freshBridge = await E\.TessaBridge\.create\(\);\n      if \(canon\(freshBridge\.matrixInfo\(\)\.matrixId\) !== canon\(report\.matrix\?\.matrixId\)\) throw new Error\('Во время UAT открыта другая матрица\.'\);\n      return \{ bridge: freshBridge, snapshot: await freshBridge\.loadSnapshot\(structure\) \};\n    \}/g,
  [
    '    async function freshSnapshot() {',
    '      // FULL_UAT_PINNED_CONTEXT_RECOVERY_V1',
    '      const freshBridge = pinnedUatBridge || await E.TessaBridge.create();',
    '      const freshInfo = freshBridge.matrixInfo();',
    '      if (report.matrix?.matrixId && canon(freshInfo.matrixId) !== canon(report.matrix.matrixId)) {',
    "        throw new Error('Pinned UAT bridge потерял исходную матрицу.');",
    '      }',
    '      return { bridge: freshBridge, snapshot: await freshBridge.loadSnapshot(structure) };',
    '    }',
    '',
    '    async function assertActiveUatContextBeforeWrite() {',
    '      const activeBridge = await E.TessaBridge.create();',
    '      const activeInfo = activeBridge.matrixInfo();',
    '      if (pinnedUatMatrixId && canon(activeInfo.matrixId) !== canon(pinnedUatMatrixId)) {',
    "        throw new Error('Во время UAT открыта другая матрица; новая запись не начата.');",
    '      }',
    '      if (pinnedUatTemplateId && canon(activeInfo.TemplateID) !== canon(pinnedUatTemplateId)) {',
    "        throw new Error('Во время UAT изменился шаблон матрицы; новая запись не начата.');",
    '      }',
    '      return activeBridge;',
    '    }',
  ].join('\n'),
  'freshSnapshot pinned context',
);

replaceOnce(
  /    async function applySingle\(plan, label\) \{[\s\S]*?      report\.writesAttempted \+= 1;/g,
  (match) => match
    .replace('async function applySingle(plan, label) {', 'async function applySingle(plan, label, options = {}) {')
    .replace('      report.writesAttempted += 1;', '      if (!options.recovery) await assertActiveUatContextBeforeWrite();\n      report.writesAttempted += 1;'),
  'pre-write active context guard',
);

replaceOnce(
  /        bridge = current\.bridge; const result = await applySingle\(plan, [^\n]+cleanup DELETE[^\n]+\);/g,
  "        bridge = current.bridge; const result = await applySingle(plan, scenarioId + ': cleanup DELETE', { recovery: true });",
  'cleanup stays pinned',
);

replaceOnce(
  /      const info = bridge\.matrixInfo\(\); report\.matrix = \{ matrixId: info\.matrixId, templateId: info\.TemplateID, name: info\.TemplateName, state: info\.StateName, rows: baseline\.rows\.length \};/g,
  [
    '      const info = bridge.matrixInfo(); report.matrix = { matrixId: info.matrixId, templateId: info.TemplateID, name: info.TemplateName, state: info.StateName, rows: baseline.rows.length };',
    '      pinnedUatBridge = bridge;',
    "      pinnedUatMatrixId = String(info.matrixId || '');",
    "      pinnedUatTemplateId = String(info.TemplateID || '');",
    "      timeline('context-pinned', 'Исходный runtime-контекст UAT закреплён для read-back/cleanup.', { matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId });",
  ].join('\n'),
  'pin initial bridge',
);

replaceOnce(
  /      \{\n        const applyOk = report\.writesAttempted > 0[\s\S]*?      \}\n\n      \/\/ Reconcile must be a real runReconciliationRead invocation\./g,
  [
    '      {',
    '        const noWriteAbort = Boolean(report.fatalError) && report.writesAttempted === 0;',
    '        const applyOk = report.writesAttempted > 0',
    '          && report.writesCompleted === report.writesAttempted',
    "          && !report.checks.some(check => check.required !== false && check.status === 'FAIL' && /^write-/.test(String(check.id || '')));",
    '        addCheck(',
    "          'action-apply',",
    "          'Действие: применить к TESSA',",
    "          noWriteAbort ? 'NOT_RUN' : (applyOk ? 'PASS' : 'FAIL'),",
    '          noWriteAbort',
    "            ? 'Apply не запускался: Full UAT остановился до первой мутации. Первичная причина сохранена в fatalError.'",
    '            : (applyOk',
    "              ? 'Реальные Apply-операции завершены и подтверждены server read-back/cleanup.'",
    "              : ('Apply evidence неполный: attempted=' + report.writesAttempted + ', completed=' + report.writesCompleted + '.')),",
    '          { required: true, data: { outcome: applyOk ? \'live-write-readback\' : null, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, notRunBecauseFatalBeforeWrite: noWriteAbort } },',
    '        );',
    '      }',
    '',
    '      // Reconcile must be a real runReconciliationRead invocation.',
  ].join('\n'),
  'Apply secondary evidence classification',
);

replaceOnce(
  /      try \{\n        if \(!reconciliationActionReceiptContext\?\.receipts\?\.length\) \{[\s\S]*?        const reconciliationResult = await E\.runReconciliationRead\(\n          async \(\) => E\.TessaBridge\.create\(\),/g,
  [
    '      try {',
    '        const noWriteAbort = Boolean(report.fatalError) && report.writesAttempted === 0;',
    '        if (noWriteAbort) {',
    "          addCheck('action-reconcile', 'Действие: сверить результат', 'NOT_RUN', 'Reconcile не запускался: Full UAT остановился до первой мутации, поэтому mutation receipt не создавался.', { required: true, data: { outcome: null, notRunBecauseFatalBeforeWrite: true } });",
    '        } else {',
    '          if (!reconciliationActionReceiptContext?.receipts?.length) {',
    "            throw new Error('Нет подтверждённого DELETE receipt для Reconcile evidence.');",
    '          }',
    '          const reconciliationResult = await E.runReconciliationRead(',
    '            async () => pinnedUatBridge || E.TessaBridge.create(),',
  ].join('\n'),
  'Reconcile no-write branch start',
);

replaceOnce(
  /        addCheck\(\n          'action-reconcile',[\s\S]*?        \);\n      \} catch \(reconcileError\) \{/g,
  (match) => match.replace(/\n      \} catch \(reconcileError\) \{$/, '\n        }\n      } catch (reconcileError) {'),
  'Reconcile no-write branch close',
);

replaceOnce(
  /packageEntries\.push\(\['failed-checks\.json', utf8\(\{ seed: report\.seed, status: report\.status, failures: report\.failedChecks \}\)\], \['FAILURES\.txt', utf8\(failureText\)\]\);/g,
  "packageEntries.push(['failed-checks.json', utf8({ seed: report.seed, status: report.status, fatalError: report.fatalError || null, failures: report.failedChecks })], ['FAILURES.txt', utf8((report.fatalError ? 'FATAL\\\\n' + report.fatalError + '\\\\n\\\\n' : '') + failureText)]);",
  'primary fatal error evidence',
);

for (const marker of [
  'FULL_UAT_PINNED_CONTEXT_RECOVERY_V1',
  'let pinnedUatBridge = null;',
  'pinnedUatBridge = bridge;',
  'async function assertActiveUatContextBeforeWrite()',
  '{ recovery: true }',
  'const noWriteAbort = Boolean(report.fatalError) && report.writesAttempted === 0;',
  'notRunBecauseFatalBeforeWrite: true',
  'fatalError: report.fatalError || null',
]) {
  if (!source.includes(marker)) throw new Error('v1.16.2 pinned-context verification failed: ' + marker);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.16.2 Full UAT pinned-context recovery: OK');
