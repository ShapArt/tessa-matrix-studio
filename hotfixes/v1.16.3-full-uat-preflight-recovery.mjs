import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (source.includes('FULL_UAT_PREFLIGHT_RECOVERY_STATE_V1')) {
  console.log('TESSA Matrix Studio v1.16.3 Full UAT preflight/recovery state: already applied');
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
  /    let pinnedUatTemplateId = '';\n/g,
  [
    "    let pinnedUatTemplateId = '';",
    '    // FULL_UAT_PREFLIGHT_RECOVERY_STATE_V1',
    "    let initializationPhase = 'not-started';",
    '    let baselineCaptured = false;',
  ].join('\n') + '\n',
  'preflight state declaration',
);

replaceOnce(
  /      timeline\('start', `Full UAT seed=\$\{seed\}`\);\n      bridge = await E\.TessaBridge\.create\(\); E\.assertWritableMatrixDraft\(bridge\); E\.assertNativeEditMode\(\);\n      structure = await bridge\.requestStructure\(bridge\.templateId\(\)\); baseline = await bridge\.loadSnapshot\(structure\); baselineSignature = snapshotSignature\(baseline\);\n      cleanupLedgerController = createCleanupLedger\(baselineSignature\); report\.cleanupLedger = cleanupLedgerController\.snapshot\(\);\n      catalog = await bridge\.loadDictionaryCatalog\(structure, baseline, \{ forceRefresh: true, transient: true \}\);\n      const info = bridge\.matrixInfo\(\); report\.matrix = \{ matrixId: info\.matrixId, templateId: info\.TemplateID, name: info\.TemplateName, state: info\.StateName, rows: baseline\.rows\.length \};\n      pinnedUatBridge = bridge;\n      pinnedUatMatrixId = String\(info\.matrixId \|\| ''\);\n      pinnedUatTemplateId = String\(info\.TemplateID \|\| ''\);\n      timeline\('context-pinned', 'Исходный runtime-контекст UAT закреплён для read-back\/cleanup\.', \{ matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId \}\);/g,
  [
    "      timeline('start', `Full UAT seed=${seed}`);",
    "      initializationPhase = 'bridge-create';",
    '      bridge = await E.TessaBridge.create();',
    "      initializationPhase = 'draft-access';",
    '      E.assertWritableMatrixDraft(bridge);',
    "      initializationPhase = 'native-edit-mode';",
    '      E.assertNativeEditMode();',
    "      initializationPhase = 'structure';",
    '      structure = await bridge.requestStructure(bridge.templateId());',
    "      initializationPhase = 'baseline';",
    '      baseline = await bridge.loadSnapshot(structure);',
    '      baselineSignature = snapshotSignature(baseline);',
    '      baselineCaptured = true;',
    '      const info = bridge.matrixInfo();',
    '      report.matrix = { matrixId: info.matrixId, templateId: info.TemplateID, name: info.TemplateName, state: info.StateName, rows: baseline.rows.length };',
    '      pinnedUatBridge = bridge;',
    "      pinnedUatMatrixId = String(info.matrixId || '');",
    "      pinnedUatTemplateId = String(info.TemplateID || '');",
    "      timeline('context-pinned', 'Исходный runtime-контекст UAT закреплён для read-back/cleanup.', { matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId });",
    '      cleanupLedgerController = createCleanupLedger(baselineSignature); report.cleanupLedger = cleanupLedgerController.snapshot();',
    "      initializationPhase = 'dictionary';",
    '      catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });',
    "      initializationPhase = 'ready';",
    "      addCheck('uat-preflight', 'Готовность Full UAT', 'PASS', 'Черновик, режим редактирования, структура, baseline и справочники подтверждены до write-фазы.', { required: true, data: { phase: initializationPhase, baselineCaptured: true, matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId } });",
  ].join('\n'),
  'initialization state machine',
);

replaceOnce(
  /        if \(version !== '1\.16\.1'\) \{\n          throw new Error\(`Загружена версия \$\{version \|\| '\(нет\)'\}, ожидалась 1\.16\.1\.`\);\n        \}\n        return \{ detail: `Подтверждён v1\.16\.1 · \$\{actualBuild\} · \$\{actualPerformanceBuild\}\.`, data: \{ version, build: actualBuild, performanceBuild: actualPerformanceBuild \} \};/g,
  [
    "        if (version !== '1.16.3') {",
    "          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.16.3.`);",
    '        }',
    "        return { detail: `Подтверждён v1.16.3 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
  ].join('\n'),
  'candidate version provenance',
);

replaceOnce(
  /    \} catch \(error\) \{\n      report\.fatalError = String\(error\?\.message \|\| error\); report\.status = cleanupUnsafe \? 'UNSAFE' : 'INCOMPLETE'; timeline\('fatal', report\.fatalError\);\n    \} finally \{\n\n      try \{/g,
  [
    '    } catch (error) {',
    '      report.fatalError = String(error?.message || error);',
    "      const abortedBeforeBaseline = !baselineCaptured && report.writesAttempted === 0;",
    "      report.status = cleanupUnsafe ? 'UNSAFE' : 'INCOMPLETE';",
    "      if (abortedBeforeBaseline && !report.checks.some(check => check.id === 'uat-preflight')) {",
    "        addCheck('uat-preflight', 'Готовность Full UAT', 'FAIL', report.fatalError, { required: true, data: { phase: initializationPhase, baselineCaptured: false, writesAttempted: 0 } });",
    '      }',
    "      timeline('fatal', report.fatalError, { phase: initializationPhase, baselineCaptured, writesAttempted: report.writesAttempted });",
    '    } finally {',
    '',
    '      const recoveryReady = Boolean(baselineCaptured && baselineSignature && structure && pinnedUatBridge && report.matrix?.matrixId);',
    '      if (!recoveryReady && report.writesAttempted === 0) {',
    "        report.finalMatrixSave = { ok: false, skipped: true, reason: 'preflight-abort-before-baseline' };",
    '        report.restoreProof = {',
    "          status: 'NOT_REQUIRED', baselineEquivalent: null, pendingObligations: 0, failedObligations: 0,",
    "          reason: 'UAT остановлен до подтверждённого baseline и до первой мутации; восстанавливать нечего.',",
    '          phase: initializationPhase, checkedAt: now(),',
    '        };',
    "        addCheck('final-restore-proof', 'Task9: восстановление baseline', 'NOT_RUN', report.restoreProof.reason, { required: true, data: report.restoreProof });",
    "        timeline('recovery-skipped', report.restoreProof.reason, { phase: initializationPhase });",
    '      } else try {',
  ].join('\n'),
  'preflight-safe recovery gate',
);

replaceOnce(
  /    button\.addEventListener\('click', async \(\) => \{\n      if \(!window\.confirm\('Полный UAT выполнит реальные операции только с временными строками в текущем черновике TESSA и будет удалять их после каждого сценария\. Запустить\?'\)\) return;/g,
  [
    "    button.addEventListener('click', async () => {",
    '      // FULL_UAT_UI_PREFLIGHT_V1',
    '      try {',
    '        const preflightBridge = await E.TessaBridge.create();',
    '        E.assertWritableMatrixDraft(preflightBridge);',
    '        E.assertNativeEditMode();',
    '      } catch (preflightError) {',
    "        status.dataset.state = 'INCOMPLETE';",
    "        status.textContent = 'INCOMPLETE · PRECHECK\\n' + String(preflightError?.message || preflightError) + '\\nНикаких изменений в TESSA не выполнялось.';",
    '        return;',
    '      }',
    "      if (!window.confirm('Полный UAT выполнит реальные операции только с временными строками в текущем черновике TESSA и будет удалять их после каждого сценария. Запустить?')) return;",
  ].join('\n'),
  'UI preflight before confirmation',
);

for (const marker of [
  'FULL_UAT_PREFLIGHT_RECOVERY_STATE_V1',
  "let initializationPhase = 'not-started';",
  'let baselineCaptured = false;',
  "initializationPhase = 'native-edit-mode';",
  'baselineCaptured = true;',
  "initializationPhase = 'dictionary';",
  "const recoveryReady = Boolean(baselineCaptured && baselineSignature && structure && pinnedUatBridge && report.matrix?.matrixId);",
  "status: 'NOT_REQUIRED'",
  "'preflight-abort-before-baseline'",
  "version !== '1.16.3'",
  'FULL_UAT_UI_PREFLIGHT_V1',
  "Никаких изменений в TESSA не выполнялось.",
]) {
  if (!source.includes(marker)) throw new Error('v1.16.3 preflight/recovery verification failed: ' + marker);
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.16.3 Full UAT preflight/recovery state: OK');
