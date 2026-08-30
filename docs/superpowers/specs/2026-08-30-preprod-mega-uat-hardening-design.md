# TESSA Matrix Studio — pre-prod mega UAT hardening design

## Goal

Подготовить TESSA Matrix Studio к крупному предпродовому UAT и нагрузочному прогону: пользователь должен иметь возможность проверить и выборочно исключить любую операцию из большого плана, destructive-операции должны иметь более строгие ограничения, частичный Apply должен оставлять однозначный отчёт о границе выполнения, а автоматические тесты должны покрывать большие mixed-наборы операций.

## Scope

В этот этап входят:

1. полный Preview/review для планов больше 40 операций;
2. фильтрация и навигация по Preview без потери возможности selective review;
3. усиленный guard массового DELETE;
4. batch warning/guard для очень больших Apply;
5. однозначный partial/cancel result;
6. автоматический mega-load regression с mixed UPDATE/ADD/DELETE/SKIP/NOOP и high-cardinality значениями;
7. документация эксплуатационных границ и сценариев UAT.

Не входят в этот этап: изменение серверного API TESSA, обход прав TESSA, транзакционный rollback нескольких CardStore/CardRequest и включение GitHub Release Immutability через код репозитория (это настройка репозитория; в CI добавляется только проверка/документация доступного состояния, если API позволяет надёжно определить его).

## Current problem

`renderPlan()` отображает только первые 40 non-NOOP действий через `previewLimit = 40`, в то время как Apply работает по всему reviewed plan. Это создаёт несоответствие между принципом «проверить перед записью» и фактическим UX большого плана: пользователь не может просмотреть или выборочно исключить операцию за пределами первых 40.

Текущий DELETE guard блокирует только `deleteCount >= 10 && ratio >= 20%`. Поэтому большие абсолютные удаления в крупной матрице могут не попасть под hard-stop.

Текущий Apply корректно поддерживает частичные ошибки и `abortRequested`, но UX и результат должны однозначно показывать три множества: успешно применено, пропущено/ошибка, не начато из-за остановки.

## Design

### 1. Large-plan Preview model

Preview остаётся основан на полном `plan.actions`. Ограничивается только рендер текущей страницы.

Добавляется session-only UI state:

- `previewPage` — текущая страница;
- `previewPageSize` — 40 по умолчанию;
- `previewFilter` — `all|update|add|delete|skip`;
- `previewQuery` — поиск по номеру Excel-строки и тексту diff/reason.

Фильтрация и пагинация не изменяют `plan` и `APP.review`. Selective review продолжает работать через стабильный `planReviewActionKey()` для любой отображаемой операции.

UI обязан показывать `Показано X–Y из N`, кнопки назад/вперёд и фильтры. Пользователь может добраться до каждой non-NOOP операции, а SKIP отображается отдельным фильтруемым списком.

### 2. Destructive delete guard

Guard становится двухуровневым:

- hard block: `deleteCount >= 10 && ratio >= 20%` — существующее правило;
- hard block: абсолютное удаление `deleteCount >= 100`, независимо от ratio.

Причина должна явно говорить, какое правило сработало. Для меньших DELETE остаётся отдельное подтверждение Apply.

Цель — не дать одним файлом удалить сотни строк. Пользователь должен разбить такое удаление на контролируемые партии.

### 3. Large batch guard

Добавляется отдельная оценка batch-size по executable actions после selective review.

Пороговые значения:

- до 500 операций — штатный Apply;
- 501–2000 — дополнительное предупреждение с количеством операций;
- больше 2000 — hard block для одного Apply.

Это operational safety limit, а не ограничение XLSX/planner. Большой Excel можно анализировать целиком, но запись выполняется контролируемыми партиями.

### 4. Partial/cancel semantics

Apply остаётся нетранзакционным: уже выполненные операции не откатываются. Это должно быть явно отражено в результате.

Результат Apply расширяется полями:

- `status`: `completed|partial|cancelled`;
- `plannedCount`;
- `startedCount`;
- `appliedCount`;
- `skippedCount`;
- `failedCount`;
- `notStartedCount`;
- `cancelled`.

Если `abortRequested` обнаружен между операциями, Apply не выбрасывает безымянную ошибку, теряя итог, а завершает формирование result с `status=cancelled`, сохраняет JSON и не запускает следующие операции. Уже завершённые мутации остаются отражены как applied.

Ошибки отдельных CardStore/CardRequest продолжают давать partial result и не маскируются как success.

### 5. Mega-load regression

Новый Node regression создаёт большой детерминированный roundtrip и проверяет planner/preflight/apply через mock bridge.

Наборы:

- 500 строк sanity;
- 1000 mixed;
- 5000 planner/load-only;
- Apply mock не более 2000 executable из-за нового operational hard limit.

Mixed profile включает NOOP, UPDATE, ADD, intentional SKIP и DELETE ниже destructive threshold. Значения и ID детерминированы, чтобы любой сбой воспроизводился по ScenarioID/индексу.

Тест проверяет:

- точные counts;
- отсутствие ложных ADD/DELETE;
- selective review на операции далеко за первой страницей;
- batch warning/hard-block thresholds;
- cancellation result;
- отсутствие dependent DELETE после неуспешного prerequisite;
- широкую кардинальность ID/названий без квадратичного провала.

### 6. Release/docs

README/PRODUCTION-RUNBOOK фиксируют operational Apply ceiling, поведение partial/cancel и необходимость полного просмотра больших планов.

Версия увеличивается с 1.9.31 до следующей patch-версии только после завершения реализации и regression coverage.

## Production invariants

1. Preview никогда не пишет в TESSA.
2. Полный effective plan доступен пользователю для просмотра/review, даже если DOM рендерит только одну страницу.
3. Selective review не меняет Excel и не теряется при переключении страниц/фильтров.
4. Apply всегда выполняет свежий preflight.
5. Нельзя одним Apply выполнить больше 2000 mutation-actions.
6. Нельзя одним Apply удалить 100 и более строк.
7. Abort не откатывает уже применённые операции, но всегда формирует точный machine-readable result.
8. Ошибка prerequisite не оставляет dependent DELETE исполняемым.
9. Любая неоднозначная identity остаётся fail-closed.

## Acceptance criteria

- план из 120 UPDATE позволяет открыть и исключить операцию №100 через Preview UI state;
- navigation/filtering не меняют counts effective plan;
- 99 DELETE из 1000 не блокируются абсолютным guard, 100 DELETE блокируются;
- 10 DELETE из 50 блокируются ratio guard;
- 501 executable требуют дополнительного подтверждения;
- 2001 executable блокируются до TESSA calls;
- остановка после N успешных Store формирует `cancelled` result с `appliedCount=N` и корректным `notStartedCount`;
- mega-load regression проходит для 500/1000/5000-row наборов в пределах существующих broad CI ceilings;
- полный `npm test` остаётся зелёным.