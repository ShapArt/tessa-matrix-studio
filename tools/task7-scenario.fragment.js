      await runCheck('write-every-field', 'Сервер: каждое доступное поле → read-back → restore', async () => {
        const temp = await createTemporaryRow('write-every-field'), rowCardId = temp.created.rowCardId;
        const audit = { rowCardId, inventory: [], evidence: [] };
        report.fieldMutationAudit = audit;
        let fatalRestore = null;
        try {
          let initial = await freshSnapshot(); bridge = initial.bridge;
          let currentCatalog = await bridge.loadDictionaryCatalog(structure, initial.snapshot, { forceRefresh: true, transient: true });
          const initialPackage = await workbookFromSnapshot(structure, initial.snapshot, bridge, currentCatalog);
          const initialBook = initialPackage.book;
          const initialTarget = findRowByCard(initialBook, rowCardId);
          if (!initialTarget) throw new Error('Временная строка не найдена перед проверкой полей.');
          const inventory = buildWritableFieldInventory(initialBook, structure, currentCatalog);
          audit.inventory = inventory.map(item => ({ token: item.token, label: item.label, kind: item.kind, strategy: item.strategy, index: item.index }));
          if (!inventory.length) return { status: 'NOT_RUN', detail: 'В текущей структуре нет доступных для записи criterion/function полей.' };

          for (const inventoryItem of inventory) {
            let mutationApplied = false;
            let original = null;
            let originalSemantic = [];
            const evidence = {
              token: inventoryItem.token,
              label: inventoryItem.label,
              kind: inventoryItem.kind,
              before: null,
              candidate: null,
              observedAfter: null,
              restoreResult: 'not-needed',
              status: 'NOT_RUN',
            };
            audit.evidence.push(evidence);
            try {
              const current = await freshSnapshot(); bridge = current.bridge;
              currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true });
              const prepared = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
              const book = prepared.book;
              const target = findRowByCard(book, rowCardId);
              const snapshotRow = current.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
              if (!target || !snapshotRow) throw new Error('Временная строка не найдена перед изолированной мутацией.');
              const liveItem = buildWritableFieldInventory(book, structure, currentCatalog).find(item => item.token === inventoryItem.token);
              if (!liveItem) {
                evidence.status = 'NOT_RUN'; evidence.restoreResult = 'not-needed'; evidence.reason = 'Поле исчезло из актуальной структуры.';
                continue;
              }
              const hiddenIndex = companionIndex(book, liveItem.token);
              original = { visible: String(target.values?.[liveItem.index] ?? ''), hidden: hiddenIndex >= 0 ? String(target.values?.[hiddenIndex] ?? '') : '' };
              originalSemantic = canonicalFieldValues(snapshotRow.flat?.[liveItem.token] || []);
              evidence.before = { visible: original.visible, hidden: original.hidden, semantic: [...originalSemantic] };

              let selected = null;
              for (const candidate of fieldCandidateValues(liveItem, original.visible).slice(0, 24)) {
                const attempt = cloneWorkbook(book);
                const attemptRow = findRowByCard(attempt, rowCardId);
                setFieldCandidate(attempt, attemptRow, liveItem, candidate);
                let plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo());
                plan = applySafety(plan, bridge);
                const executable = (plan.actions || []).filter(action => action.type !== 'noop');
                const update = executable.length === 1 && executable[0].type === 'update' && canon(executable[0].currentRow?.rowCardId) === canon(rowCardId) ? executable[0] : null;
                const change = update?.changes?.find(item => item.key === liveItem.token);
                if (update && change && !plan.counts?.skip && !plan.safety?.blocked) {
                  selected = { candidate, plan, expectedAfter: canonicalFieldValues(change.after || []) };
                  break;
                }
              }
              if (!selected) {
                evidence.status = 'NOT_RUN'; evidence.restoreResult = 'not-needed'; evidence.reason = 'Не найдено безопасное альтернативное значение, дающее единственный UPDATE.';
                continue;
              }

              evidence.candidate = candidateEvidenceValue(selected.candidate);
              await applySingle(selected.plan, `write-every-field ${liveItem.token}: UPDATE`);
              mutationApplied = true;
              const after = await freshSnapshot(); bridge = after.bridge;
              const afterRow = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
              if (!afterRow) throw new Error('Временная строка исчезла после мутации поля.');
              const observedAfter = canonicalFieldValues(afterRow.flat?.[liveItem.token] || []);
              evidence.observedAfter = [...observedAfter];
              if (!sameArray(observedAfter, selected.expectedAfter)) {
                throw new Error(`Read-back ${liveItem.token} не совпал с ожидаемым значением: expected=${JSON.stringify(selected.expectedAfter)} actual=${JSON.stringify(observedAfter)}.`);
              }
              evidence.status = 'PASS';
            } catch (error) {
              evidence.status = 'FAIL';
              evidence.error = String(error?.message || error);
            } finally {
              if (mutationApplied && original) {
                try {
                  const restoreState = await freshSnapshot(); bridge = restoreState.bridge;
                  const restoreCatalog = await bridge.loadDictionaryCatalog(structure, restoreState.snapshot, { forceRefresh: true, transient: true });
                  const restorePackage = await workbookFromSnapshot(structure, restoreState.snapshot, bridge, restoreCatalog);
                  const restoreBook = restorePackage.book;
                  const restoreRow = findRowByCard(restoreBook, rowCardId);
                  const restoreItem = buildWritableFieldInventory(restoreBook, structure, restoreCatalog).find(item => item.token === inventoryItem.token);
                  if (!restoreRow || !restoreItem) throw new Error('Поле или временная строка недоступны для restore.');
                  restoreRow.values[restoreItem.index] = original.visible;
                  const restoreHiddenIndex = companionIndex(restoreBook, restoreItem.token);
                  if (restoreHiddenIndex >= 0) restoreRow.values[restoreHiddenIndex] = original.hidden;
                  let restorePlan = E.buildPlan(restoreBook, structure, restoreState.snapshot, bridge.matrixInfo());
                  restorePlan = applySafety(restorePlan, bridge);
                  const restoreExecutable = (restorePlan.actions || []).filter(action => action.type !== 'noop');
                  const beforeRestoreRow = restoreState.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                  if (!sameArray(canonicalFieldValues(beforeRestoreRow?.flat?.[restoreItem.token] || []), originalSemantic)) {
                    if (restoreExecutable.length !== 1 || restoreExecutable[0].type !== 'update' || canon(restoreExecutable[0].currentRow?.rowCardId) !== canon(rowCardId) || restorePlan.counts?.skip || restorePlan.safety?.blocked) {
                      throw new Error(`restore не построил единственный безопасный UPDATE для ${restoreItem.token}.`);
                    }
                    await applySingle(restorePlan, `write-every-field ${restoreItem.token}: restore`);
                  }
                  const restored = await freshSnapshot(); bridge = restored.bridge;
                  const restoredRow = restored.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                  const restoredSemantic = canonicalFieldValues(restoredRow?.flat?.[restoreItem.token] || []);
                  if (!sameArray(restoredSemantic, originalSemantic)) throw new Error(`restore read-back ${restoreItem.token} не совпал с исходным значением.`);
                  evidence.restoreResult = 'verified';
                } catch (restoreError) {
                  cleanupUnsafe = true;
                  evidence.restoreResult = `FAILED: ${String(restoreError?.message || restoreError)}`;
                  evidence.status = 'FAIL';
                  fatalRestore = restoreError;
                }
              }
            }
            if (fatalRestore) break;
          }

          const passCount = audit.evidence.filter(item => item.status === 'PASS').length;
          const failCount = audit.evidence.filter(item => item.status === 'FAIL').length;
          const notRunCount = audit.evidence.filter(item => item.status === 'NOT_RUN').length;
          if (fatalRestore) throw new Error(`Не удалось доказать restore одного из полей: ${String(fatalRestore?.message || fatalRestore)}.`);
          if (failCount) throw new Error(`Каждое поле проверено не полностью: PASS ${passCount}, FAIL ${failCount}, NOT_RUN ${notRunCount}.`);
          if (!passCount) return { status: 'NOT_RUN', detail: `Ни для одного из ${inventory.length} полей не найдено безопасной альтернативы.`, data: audit };
          return { status: 'PASS', detail: `Изолированно проверено ${passCount} полей; NOT_RUN ${notRunCount}. Для каждой записи выполнен read-back и restore.`, data: audit };
        } finally {
          const cleaned = await cleanupCreatedRow(rowCardId, 'write-every-field');
          if (!cleaned) cleanupUnsafe = true;
          const final = await freshSnapshot();
          if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) {
            cleanupUnsafe = true;
            throw new Error('После every-field UAT исходная матрица отличается от baseline.');
          }
        }
      });
