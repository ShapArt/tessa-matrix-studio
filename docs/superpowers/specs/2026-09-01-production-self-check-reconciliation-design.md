# TESSA Matrix Studio — production self-check + post-Apply reconciliation design

## Goal

Сделать следующий production-hardening слой после v1.9.39:

1. заранее определять, совместима ли текущая web-сборка TESSA с теми runtime-возможностями, которые реально нужны Studio;
2. после Apply уметь отдельной read-only проверкой подтвердить фактическое состояние затронутых строк в свежем snapshot TESSA;
3. отделить результат записи (`Store/Delete result`) от результата проверки конечного состояния (`reconciliation result`);
4. дать поддержке диагностический отчёт без автоматической утечки значений критериев, ролей, контрагентов и других бизнес-данных.

Этот этап не заменяет planner/preflight/race guards v1.9.x и не делает Apply транзакционным.

## Context

К v1.9.39 Studio уже имеет:

- Roundtrip V6 с baseline/identity ledger;
- fail-closed planner и Preview preflight;
- stale/source/duplicate checks;
- store-time race protection;
- selective review и пакетирование Apply;
- DELETE/batch hard guards;
- exact partial/cancel accounting;
- source-skipped строки отдельно от mutation-plan;
- native-view-only post-Apply refresh без `editor.refreshCard()`;
- ограниченный retry transient writer-lock при refresh.

Остаточные эксплуатационные риски:

- часть integration surface Studio получает через runtime web-клиента TESSA (`apiLoader`, workspace/editor/card model, CardService, native matrix view). После обновления TESSA один из этих контрактов может измениться независимо от бизнес-логики Studio;
- успешный Store подтверждает принятие mutation request сервером, но пользовательский production gate всё ещё требует ручной fresh-export reconciliation;
- support diagnostics не должны автоматически включать содержимое рабочих строк.

## External API evidence

Публичная документация TESSA 4.2 подтверждает нужную концептуальную модель:

- `IWorkplaceViewComponent` реализует `IRefresh` и `IPagingSource`, имеет `CurrentPage`, `CanRefresh` и `Refresh`;
- `CardStoreRequest.AffectVersion` включает проверку версии карточки во время Store и увеличение версии.

Это не означает, что конкретный JS runtime обязан иметь один фиксированный внутренний shape. Поэтому capability self-check проверяет фактический runtime, а не жёстко предполагает его.

References:

- https://mytessa.ru/docs/4.2/api/html/T_Tessa_UI_Views_IWorkplaceViewComponent.htm
- https://mytessa.ru/docs/4.2/api/html/T_Tessa_Cards_CardStoreRequest.htm
- https://mytessa.ru/docs/4.2/api/html/T_Tessa_Cards_CardGetRequest.htm

## Scope

### A. Runtime capability self-check

Добавляется чистая capability-модель, которую можно построить без записи в TESSA.

Предлагаемая форма:

```text
RuntimeCapabilities
  overall: ready | limited | incompatible
  runtime
    apiLoader
    workspace
    editor
    cardModel
  cardService
    cardGet
    cardNew
    cardStore
    cardRequest
    affectVersion
  matrix
    matrixId
    templateId
    stateReadable
    writableState
  nativeView
    found
    refresh
    paging
    currentPage
  operations
    export
    analyze
    apply
    refreshView
    reconcile
  blockers[]
  warnings[]
```

Capability-check не должен выполнять `CardStore`, `DeleteRow`, `CardNew`, `ValidateDuplicate` или любую другую mutation.

#### Severity rules

`ready`:

- доступны обязательные runtime/card primitives для текущей операции;
- MatrixID/TemplateID/State читаются там, где они нужны;
- нативный view или другой уже доказанный read-path позволяет безопасно получить требуемую identity;
- optional capabilities для текущего UX доступны.

`limited`:

- основная запрошенная операция безопасно возможна;
- отсутствует необязательная capability, например local view refresh;
- UI явно показывает, какая функция ограничена и какой есть fallback.

`incompatible`:

- отсутствует capability, без которой конкретную операцию нельзя выполнить безопасно;
- соответствующее действие блокируется до любых TESSA mutation calls.

Capability оценивается **по операции и по effective plan**, а не одним глобальным «всё или ничего» флагом.

Примеры:

- отсутствие `CardNew` блокирует ADD, но не обязано блокировать UPDATE-only Apply;
- отсутствие Store primitive блокирует UPDATE/ADD, но не read-only export/reconciliation;
- отсутствие DELETE request primitive блокирует DELETE, но не UPDATE/ADD;
- отсутствие local view refresh не блокирует успешный Store;
- отсутствие native view может быть `limited` только если существует уже доказанный альтернативный read-path с той же строгой identity. Если такой альтернативы нет и MatrixRowID/MatrixVersionID нельзя получить безопасно, export/analyze становятся `incompatible` — никаких guessed IDs.

### B. Capability UI

В верхней части Studio рядом с progress/status появляется компактный статус среды:

- `Среда: готова`;
- `Среда: ограничена`;
- `Среда: несовместима`.

По клику раскрывается короткий список capability без внутренних stack trace.

Не показывать пользователю сырые номера apiLoader-модулей и внутренние объекты как основной UX. Они могут попадать только в explicit diagnostic report.

Capability-check выполняется:

1. при инициализации панели;
2. повторно перед Analyze/Apply для критичных capabilities конкретной операции/effective plan;
3. по явной кнопке `Повторить проверку`, если состояние limited/incompatible.

Кэш capability session-only и инвалидируется при смене card/workspace identity.

### C. Post-Apply reconciliation

После любого Apply, в котором `startedCount > 0`, старый Preview остаётся consumed независимо от reconciliation.

В consumed state добавляется кнопка:

**Проверить результат**

Она выполняет только fresh read и строит отдельный `ReconciliationResult`.

Предлагаемая форма:

```text
ReconciliationResult
  status: verified | divergent | incomplete
  startedAt
  finishedAt
  requestedCount
  checkedCount
  verifiedCount
  divergentCount
  missingCount
  unknownCount
  retryable
  rows[]
    mutationType: update | add | delete
    excelRow
    targetIdentity
    status: verified | divergent | missing | unknown
    reasonCode
```

`rows[]` по умолчанию не содержит flat business values.

### D. Reconciliation identity source

Для проверки нельзя использовать только display-fingerprint.

Во время Apply формируется минимальный **private session mutation receipt**. Он нужен для последующей read-only reconciliation, но не должен автоматически попадать в `APP.lastReport`, download-report или другой support JSON.

#### UPDATE

Receipt сохраняет:

- Excel row;
- target RowCardID;
- target MatrixVersionID / resulting version identity, если TESSA её возвращает/можно безопасно определить;
- expected typed semantic key конечной строки;
- mutation type.

Fresh reconciliation ищет target по стабильной identity и затем сравнивает typed semantic state.

#### ADD

После успешного CardNew/Store receipt обязан сохранить identity созданной строки настолько точно, насколько её возвращает существующий bridge.

Reconciliation не должен «угадывать ADD по похожим значениям». Если созданную identity нельзя доказать, статус этой строки `unknown`, а не semantic nearest-match.

#### DELETE

DELETE в TESSA не обязан означать физическое исчезновение row-card из серверного хранилища/истории. Поэтому reconciliation проверяет **текущий состав матрицы**:

- target MatrixVersionID / active membership отсутствует среди текущих строк матрицы => `verified`;
- target version всё ещё является текущим участником матрицы => `divergent`;
- fresh snapshot неполный/identity неоднозначна => `unknown`.

Нельзя считать DELETE неуспешным только потому, что historical CardGet по RowCardID всё ещё возвращает карточку.

### E. Semantic comparison

Reconciliation использует ту же typed-semantic нормализацию, которая уже применяется в safety logic для Boolean / Int / Decimal / Date / DateTime и canonical text/reference identity.

Нельзя использовать UI display name как единственный признак равенства для reference/role значений, когда доступны стабильные ID.

Смена display-name при том же стабильном ID не должна давать ложный `divergent`.

### F. Fresh read strategy

Reconciliation всегда создаёт fresh bridge/snapshot и не использует старый planner snapshot как источник истины.

Приоритет:

1. targeted read затронутых RowCardID, если текущий bridge может надёжно получить строки по identity и доказать их current matrix membership;
2. иначе один fresh matrix snapshot + O(1) indexes по RowCardID/VersionID.

Запрещён O(N × M) поиск каждой mutation по полной матрице.

Для 500 затронутых mutation rows reconciliation должен оставаться линейным относительно размера fresh snapshot + mutation count.

### G. Writer-lock / read conflict

Reconciliation использует отдельный bounded retry только для известных transient read/writer-lock ошибок.

Default policy:

- attempts: 3;
- exponential backoff: 450 ms, 900 ms;
- non-lock validation/permission/runtime errors не retry автоматически.

Если retry исчерпан:

- mutation не повторяется;
- Store-result не изменяется;
- reconciliation `status=incomplete`, `retryable=true` только для transient случая;
- UI предлагает вручную повторить **Проверить результат**.

### H. Store-result vs reconciliation-result

Это два независимых факта.

Пример:

```text
ApplyResult
  status=completed
  success=true
  appliedCount=11

ReconciliationResult
  status=divergent
  verified=10
  divergent=1
```

Studio не переписывает исторический ApplyResult в `partial` задним числом.

В UI показывается:

- `Запись: завершена, 11/11`;
- `Проверка результата: 10 подтверждено, 1 расхождение`.

Так поддержка видит и факт ответа Store, и фактическое последующее состояние.

### I. No automatic repair

Reconciliation никогда не вызывает:

- Store;
- DeleteRow;
- повторный ADD;
- auto-rollback;
- auto-merge;
- восстановление старого Preview.

При divergent/unknown следующий mutation возможен только через новый export/analyze/preflight path.

### J. Privacy-safe diagnostics

Добавляется support report schema с двумя уровнями.

#### Default diagnostic report

Допустимо:

- Studio version;
- timestamp;
- browser/platform metadata в разумном объёме;
- capability booleans/status/reason codes;
- counts/timings;
- operation/reconciliation statuses;
- MatrixID/TemplateID только при explicit user download, как уже допускает issue scope.

Для ошибок по умолчанию сохраняются стабильный `reasonCode`, категория и безопасный allowlisted summary. **Произвольный upstream `error.message` не сериализуется автоматически**, потому что серверная диагностика может содержать имена/значения рабочих данных.

Не включать по умолчанию:

- значения criteria;
- expected semantic keys из private mutation receipts;
- названия ролей/исполнителей;
- контрагентов;
- комментарии;
- business text cells;
- произвольный raw `error.message`;
- полный snapshot;
- полный workbook.

#### Optional deep diagnostic

Не входит в v1.9.40. Если понадобится позже, проектируется отдельно с явным consent.

## Components and boundaries

### Pure helpers

Предлагаемые новые helpers:

- `evaluateRuntimeCapabilities(env)`;
- `capabilityOperationAvailability(capabilities, operationContext)`;
- `buildMutationReceipts(applyContext)`;
- `indexSnapshotForReconciliation(snapshot)`;
- `reconcileMutationReceipts(receipts, snapshot, structure)`;
- `reconciliationSummary(result)`;
- `sanitizeSupportReport(report)`.

Pure helpers экспортируются в test mode.

### TessaBridge

Bridge отвечает только за получение runtime primitives и fresh read:

- `runtimeCapabilities()`;
- `loadFreshReconciliationSnapshot()` или targeted equivalent;
- существующие read methods переиспользуются, если их контракт достаточно строгий.

Business reconciliation rules не зашиваются в bridge.

### UI

UI только:

- отображает capability status;
- включает/блокирует действия по operation availability;
- запускает explicit reconciliation;
- показывает summary и retry;
- не изменяет mutation receipts.

## Error model

Reason codes должны быть стабильными для тестов/диагностики, пользовательский текст может быть локализован отдельно.

Минимум:

- `runtime-api-loader-missing`;
- `workspace-missing`;
- `card-service-missing`;
- `card-primitives-incomplete`;
- `matrix-identity-unavailable`;
- `native-view-missing`;
- `native-view-refresh-unavailable`;
- `reconcile-target-missing`;
- `reconcile-semantic-divergence`;
- `reconcile-identity-unknown`;
- `reconcile-writer-lock`;
- `reconcile-read-failed`.

## Performance

- capability-check: без full matrix snapshot;
- reconciliation: максимум один full fresh snapshot на один manual check, если targeted read недостаточен;
- indexes строятся один раз;
- mutation lookup O(1) average;
- 500-row reconciliation получает broad CI ceiling, не SLA;
- отсутствие quadratic regression проверяется отдельным high-cardinality fixture.

## Security and safety invariants

1. Capability self-check read-only.
2. Reconciliation read-only.
3. No permissions bypass.
4. No `editor.refreshCard()` ради self-check/reconciliation.
5. Identity ambiguity => `unknown`/block, never guessed match.
6. Old Apply-plan remains consumed after any started mutation.
7. Reconciliation mismatch never triggers automatic mutation.
8. Apply result is immutable historical receipt; reconciliation is a separate later observation.
9. Private mutation receipts не сериализуются в default support report.
10. Default diagnostics contain no business row values и no arbitrary upstream error text.
11. Current Roundtrip/XLSX security ceilings remain unchanged.

## TDD acceptance matrix

### Capability

1. missing `apiLoader` => `incompatible`, зависящие от runtime export/analyze/apply unavailable;
2. workspace/editor/card model missing => precise blocker;
3. CardGet available but Store primitives missing => read/export may remain available, Apply unavailable для mutation типов, которым нужен Store;
4. missing CardNew => ADD unavailable, UPDATE-only Apply остаётся доступен при остальных capabilities;
5. missing DeleteRow request primitive => DELETE unavailable, UPDATE/ADD unaffected;
6. native view missing => `limited` только при доказанном альтернативном identity read-path, иначе соответствующие export/analyze блокируются;
7. native view found but refresh missing => Apply allowed, `refreshView=false`;
8. MatrixID/TemplateID unavailable => Analyze/Apply blocked fail-closed.

### Reconciliation

9. UPDATE fresh state semantically equals receipt => verified;
10. same stable reference ID but renamed display => verified;
11. UPDATE changed after Apply => divergent;
12. ADD created identity present and state equal => verified;
13. ADD identity cannot be proven => unknown, never guessed;
14. DELETE target version absent from current matrix membership => verified even if historical row-card still exists;
15. DELETE target version still current => divergent;
16. one divergent among 100 verified => overall divergent with exact counts;
17. writer-lock succeeds on retry 3 => verified/incomplete according to fresh result, mutation calls remain zero;
18. writer-lock exhausted => incomplete + retryable;
19. permission/runtime error => no blind retry;
20. reconciliation never changes `APP.plan` back to executable state.

### Privacy/performance

21. default support report contains no supplied business cell sentinel strings;
22. default support report contains no private semantic-key sentinel and no arbitrary upstream error sentinel;
23. 500 receipts over a large snapshot remain within broad linear-performance ceiling;
24. full existing `npm test` remains green.

## Release / rollout

v1.9.40 runtime implementation starts only after v1.9.39 live gate is closed and PR #49 is integrated or otherwise explicitly superseded.

Suggested delivery sequence:

1. capability pure helpers + RED/GREEN tests;
2. capability UI and operation gating;
3. mutation receipt schema;
4. pure reconciliation engine;
5. bridge fresh-read integration;
6. consumed-state `Проверить результат` UX;
7. privacy-safe diagnostics;
8. 500-row/performance regression;
9. full regression + CodeQL;
10. controlled live UAT: 1 UPDATE, 1 ADD, 1 DELETE only on disposable/test matrix with fresh reconciliation.

## Out of scope

- multi-operation transactional rollback;
- server-side plugin/extension installation;
- replacement of TESSA permissions;
- background monitoring;
- automatic mutation repair;
- automatic deep diagnostics upload;
- restructuring the userscript into a new framework/build system in this release.

## Success criteria

v1.9.40 is ready for live UAT when:

- Studio can explain before mutation which runtime capabilities are ready/limited/incompatible;
- capability gating зависит от фактической операции/effective plan, а не блокирует всё из-за одной необязательной primitive;
- missing optional view refresh does not unnecessarily block safe Apply;
- missing critical identity/write primitives fail closed before mutation;
- successful Apply can be independently reconciled against fresh TESSA state;
- UPDATE/ADD/DELETE verification is identity-driven and typed-semantic;
- DELETE проверяется по current matrix membership, а не по физическому существованию historical row-card;
- mismatch never triggers mutation;
- reconciliation cannot revive a consumed plan;
- default diagnostics remain free of business row values, private semantic receipts и arbitrary upstream error text;
- full existing safety/load/security suite and new tests are green.