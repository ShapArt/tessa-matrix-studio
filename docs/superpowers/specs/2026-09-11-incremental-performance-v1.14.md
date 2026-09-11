# TESSA Matrix Studio v1.14 — Incremental Performance & Excel Review Spec

## Goal

Сделать следующий релиз Studio инкрементальным редактором: не перечитывать и не перепроверять всю матрицу, когда изменены единицы строк; при этом сохранить fail-closed safety, stale-checks и verified read-back.

## Requirements

### 1. Performance instrumentation

- Измерять длительность ключевых стадий: structure, snapshot, dictionaries, XLSX parse/build, planner, preflight, duplicate validation, Store/Delete, reconciliation, UI refresh.
- Сохранять метрики только в памяти вкладки и включать их в diagnostics/support report.
- Не отправлять метрики наружу.

### 2. Session cache

- Кэш живёт только в памяти текущей вкладки.
- Ключ контекста: MatrixID + TemplateID.
- Кэш содержит structure, plain snapshot, row index/fingerprints, dictionary catalog и dictionary indexes.
- Кэш инвалидируется при смене MatrixID/TemplateID, явном refresh, недоказанной актуальности данных и после мутации только в затронутой части либо полностью, если частичное обновление нельзя доказать.
- localStorage/sessionStorage/IndexedDB не используются для снимка матрицы. Существующий dictionary persistent-cache можно оставить как отдельный механизм.

### 3. Incremental diff

- Для каждой существующей строки использовать baseline fingerprint.
- Неизменённые строки проходят только дешёвое сравнение fingerprint и не запускают полную dictionary/type validation.
- Полная validation выполняется только для ADD/UPDATE/DELETE/SKIP candidates.
- Физически удалённая или полностью очищенная существующая строка должна распознаваться как DELETE.
- Копия существующей строки с изменёнными значениями должна определяться как новая строка без повторного использования source identity.

### 4. Touched-only preflight/apply/read-back

- ADD-only: проверять текущий matrix/template/editor state, справочники затронутой строки, duplicate validation и созданную строку после Store; не перечитывать весь snapshot без необходимости.
- UPDATE-only: свежо читать только затронутые RowID и проверять их версии/значения.
- DELETE-only: свежо проверять только удаляемые RowID/VersionID.
- Mixed apply использует объединение затронутых identity.
- При любой неоднозначности или невозможности доказать актуальность — fallback на существующий полный безопасный путь, а не пропуск проверки.
- После Apply reconciliation сначала использует mutation receipts/touched IDs. Полный read-back допускается только как fallback.

### 5. Employee labels in Excel

- Для personal role primary display: `Фамилия И.О. — Должность`.
- Сохранять shortName, fullName, position, department, RoleID, RoleTypeID.
- Resolver принимает exact `ФИО — должность`, exact short FIO и exact full FIO.
- Bare FIO разрешается только при однозначном совпадении.
- При нескольких людях с одинаковым ФИО без должности — validation error, никакого угадывания.
- Hidden RoleID остаётся приоритетной identity для существующих строк.

### 6. Export reviewed changes

- После Preview доступна кнопка `Скачать изменения в Excel`.
- Книга содержит только ADD/UPDATE/DELETE/SKIP, без KEEP.
- Лист `Изменения`: те же рабочие поля + колонка `Изменение` + `Excel row` + `Причина`.
- Цветовая семантика: ADD green, UPDATE yellow, DELETE red, SKIP/error orange/red.
- Для UPDATE отдельный лист `Детали изменений`: Excel row, поле, было, стало.
- Это report workbook, не round-trip source для Apply; служебная metadata явно помечает report-only.

### 7. Performance UAT

Автоматические сценарии минимум:
- 0 changes;
- 1 ADD;
- 10 ADD;
- 100 ADD;
- 1 UPDATE;
- 10 UPDATE;
- 1 DELETE;
- mixed 10;
- 3000 KEEP + 1 ADD;
- 3000 KEEP + 1 UPDATE.

Отчёт показывает total rows, fully validated rows, preflight rows, cache hit/miss и timings.

### 8. README

- Не делать новый redesign.
- Сохранить восстановленный README и реальный пользовательский screenshot `docs/assets/studio-panel.webp`.
- Менять README только если новая функциональность требует короткого описания кнопок/поведения.

### 9. Colleague announcement

Подготовить текст письма после подтверждённых performance-метрик и UAT. Не заявлять конкретное ускорение до измерения на live TESSA.

## Safety invariants

- Никакой оптимизации ценой пропуска stale/identity checks.
- Неизвестный/ambiguous RoleID/FIO — fail closed.
- Cross-matrix replacement остаётся атомарным.
- Unsaved-editor guard остаётся обязательным.
- Store/Delete не запускаются до успешного preflight для всего выбранного mutation set.
- `verified` означает фактический read-back затронутого результата, а не только успешный transport response.

## Release strategy

Работа идёт в отдельной ветке. Текущий production `v1.13.0` не изменяется. Новый релиз формируется только после regression suite, performance UAT и live проверки на тестовой TESSA.
