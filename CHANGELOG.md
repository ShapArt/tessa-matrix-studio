# Changelog

## 1.9.37 — 2026-08-31

- живой Apply подтвердил успешную запись 13/13 операций, но после Store нативный `TestMatrixView / MtxRouteMatrixDummyView` дважды показывал HTTP 400 `ObtainWriterLock for MatrixRow.WriteHeartbit...`;
- Studio больше не вызывает принудительный `editor.refreshCard()` сразу после Store/Delete, поэтому не инициирует лишний reload представления в чувствительном окне нативной writer-lock/heartbeat логики TESSA;
- успешный/partial/cancelled Apply и необработанная ошибка больше не создают JSON-файлы автоматически: последний отчёт хранится в памяти вкладки и скачивается только вручную кнопкой **«Скачать отчёт»**;
- после любой реально начатой mutation-операции текущий Preview/snapshot/bridge инвалидируются: старый план нельзя случайно применить повторно, следующий пакет начинается с новой проверки свежего состояния;
- pre-write Stop (`startedCount=0`) по-прежнему не уничтожает безопасно проверенный план;
- добавлены RED→GREEN regressions на отсутствие forced post-Apply refresh, opt-in diagnostics и consumption устаревшего Apply-plan; версия поднята до 1.9.37.

## 1.9.36 — 2026-08-31

- большой Preview получил встроенный **«Пакет для Apply»**: можно оставить первые `1 / 10 / 100 / 500 / 2000` операций из выбранного типа и быстро вернуть исходный план без ручного выключения тысяч строк;
- пакетный выбор теперь учитывает не только фильтр `Все / Изменить / Добавить / Удалить`, но и активный поиск Preview, поэтому видимая найденная строка не может быть подменена первой строкой того же типа вне поиска;
- oversized UX стал компактнее и actionable: Step 4 называется **«Применение»**, а блокировка >2000 прямо указывает использовать «Пакет для Apply» вместо повторения одного и того же error-текста;
- production runbook синхронизирован с фактическим UX: отдельного DELETE-only confirm больше нет, destructive guards остаются, а контролируемое разбиение большого Preview выполняется через selective review/package builder;
- версия поднята до 1.9.36, чтобы Tampermonkey видел новый package-builder как отдельное обновление через `@version`.

## 1.9.35 — 2026-08-31

- live MAX UAT подтвердил корректный hard-stop для пакета на 8505 операций, но выявил UX-разрыв: кнопка Apply оставалась кликабельной, поэтому ожидаемый лимит >2000 показывался как modal-ошибка и автоматически скачивал ErrorReport;
- Preview теперь вычисляет единое `applyAvailability`: operational ceiling, общий safety-state и selective review определяют доступность Apply до клика;
- при >2000 операций кнопка Apply disabled и показывает `Пакет слишком большой · N / 2000`, рядом выводится встроенное объяснение, а Preview/paging/filter/search остаются доступными;
- ожидаемый policy-block больше не создаёт `TESSA_Matrix_ErrorReport_*.json` и не открывает alert; внутренний hard-stop `applyPlan()` сохранён как defense-in-depth;
- добавлен regression на форму реального UAT: 8505 executable + 4 SKIP должны быть blocked в Preview, 2000 операций остаются разрешёнными, пустой план не включает Apply.

## 1.9.34 — 2026-08-31

- XLSX SpreadsheetML parser корректно принимает легальные self-closing пустые строки вида `<row r="2"/>`; раньше row-regex ошибочно захватывал следующую строку и мог сообщать `A3 ... находится внутри строки 2`;
- security-проверка координат не ослаблена: реальный mismatch `<row r="2"><c r="A3">` по-прежнему fail-closed отклоняется, как и дубли строк/ячеек и структурные лимиты;
- версия userscript поднята до 1.9.34, чтобы установленная 1.9.33 с ошибочным row-parser гарантированно отличалась при обновлении.

## 1.9.33 — 2026-08-31

- версия userscript поднята после pre-prod UX/performance изменений, чтобы Tampermonkey/Violentmonkey гарантированно увидел новую сборку через `@version`, а не продолжал выполнять старую 1.9.32;
- Stop во время read-only preflight теперь прекращает ожидание зависшего TESSA Promise и не запускает следующие проверки; уже стартовавший внутренний запрос может завершиться позже, но Store/Delete после такой остановки не начинаются;
- ADD/DELETE можно целиком переключить в «Не применять»/вернуть из Preview, UPDATE сохраняет и целиковое, и поколоночное selective review;
- отдельный DELETE-only `confirm()` удалён; число удалений остаётся в общем подтверждении, destructive guards и свежие проверки цели сохранены;
- глубокий ADD-preflight показывает `0 из N · жду ответ TESSA`, heartbeat по времени ожидания и затем обычный ETA, вместо визуально зависшего прогресса.

## 1.9.32 — 2026-08-30

- Preview больших планов больше не ограничен первыми 40 действиями: добавлены постраничный просмотр, фильтры UPDATE/ADD/DELETE/SKIP и поиск по строке/значениям; selective review доступен для любой операции полного плана;
- selective review теперь одинаково управляет всеми типами мутаций: UPDATE можно исключать целиком или по отдельным полям, ADD и DELETE можно целиком переключить в «Не применять» и затем вернуть до Apply; счётчики и фактический Apply-план пересчитываются по выбранным операциям;
- отдельный браузерный `confirm()` только для DELETE удалён как дублирующий: количество удалений остаётся в общем подтверждении Apply, а destructive delete-guards, свежий preflight и store-time проверки не ослаблены;
- глубокий ADD-preflight больше не выглядит зависшим до первого ответа TESSA: перед сетевой проверкой показывается `0 из N · жду ответ TESSA`, во время ожидания раз в секунду обновляется elapsed-time heartbeat, а после первых завершённых операций используется обычный счётчик и ETA;
- долгие проверки теперь показывают понятный этап `1/6 … 6/6`, обработанное количество и динамический ETA по фактической скорости текущего этапа; большой локальный Preview периодически отдаёт управление браузеру, чтобы шкала прогресса и UI продолжали перерисовываться;
- Preview пакетов свыше 2000 мутаций больше не делает тысячи бессмысленных `CardNew + ValidateDuplicate` для каждого ADD: такой пакет всё равно hard-blocked для Apply, поэтому Preview выполняет локальные проверки и показывает предупреждение; после разделения до <=2000 каждая реально применяемая часть проходит полную свежую серверную preflight-проверку;
- глубокий ADD-preflight для применяемых пакетов <=2000 использует ограниченную конкуренцию до 4 независимых проверок вместо строго последовательной обработки, при этом Apply-time freshness/version/duplicate guards сохранены;
- destructive DELETE guard дополнен абсолютным hard-stop: 100 и более удалений одним пакетом блокируются независимо от доли матрицы; существующий порог 10+ DELETE при >=20% матрицы сохранён;
- Apply получил operational ceiling: 501–2000 мутаций требуют дополнительного подтверждения, более 2000 блокируются до создания TESSA bridge и любых TESSA-вызовов;
- Stop во время Apply больше не теряет границу частичного выполнения: результат получает статусы `completed / partial / cancelled` и точные `planned/started/applied/skipped/failed/notStarted` счётчики без обещания rollback уже выполненных записей;
- добавлен mega mixed-load regression: 500-row sanity, 1000-row UPDATE+ADD+SKIP, отдельный свежий physical DELETE пакет и 5000-row export → import → plan; на GitHub runner mega 5000 roundtrip занимает около 1.3 с, полный mega-suite около 1.9 с при ~80 MiB heap growth;
- зафиксировано fail-closed правило V6: физический DELETE и новые no-identity ADD выполняются отдельными свежими пакетами, потому что их смешение может быть неотличимо от потери hidden MatrixRowID/MatrixVersionID;
- production-runbook уточнён: GitHub Release Immutability — отдельная настройка репозитория, а не следствие SHA-256/CI; её необходимо включить вручную перед production release.

## 1.9.31 — 2026-08-29

- повторные fragment/not-found разрешения одного значения во встроенном справочнике теперь используют bounded per-catalog cache (до 2048 результатов) вместо повторного линейного сканирования большого `searchRows`;
- exact ID index больше не добавляет одну и ту же запись дважды в fallback-ключ `id|`, когда `RoleTypeID` пуст;
- добавлен high-cardinality regression: 25 000+ записей справочника, 10 000 exact ID lookup, неоднозначные display names и полный export → import → plan без ложных изменений;
- OPC worksheet relationships теперь учитывают `TargetMode`: `External` fail-closed отклоняется до разрешения ZIP-part даже при локально выглядящем `Target`;
- regression покрывает internal/root-relative/dot-segment/backslash targets и отклонение root-escape, URL/file/network-path и explicit External relationship.

## 1.9.30 — 2026-08-29

- OOXML Relationship Target для листов теперь разрешается относительно `xl/workbook.xml` с нормализацией безопасных `.`/`..` URI-сегментов вместо буквального поиска пути внутри ZIP;
- внешние URI и Relationship, выходящие выше корня XLSX-пакета, fail-closed отклоняются вместо попытки угадать локальную часть;
- добавлен regression-pack V1–V5: старые roundtrip-форматы продолжают читаться и строить чистый Preview, но физически отсутствующая строка не превращается в V6-only implicit DELETE без baseline-ledger;
- актуализация legacy workbook сохраняет текущие строки TESSA и последующий export формирует V6 с полным baseline-ledger;
- добавлен нагрузочный export → import → plan regression на 500 / 1000 / 5000 строк; untouched книги обязаны давать только NOOP и оставаться в действующих XLSX/SpreadsheetML лимитах.

## 1.9.29 — 2026-08-29

- `sharedStrings.xml` теперь разбирается одинаково для обычных и namespace-prefixed SpreadsheetML-элементов (`<si>/<t>` и `<x:si>/<x:t>`);
- rich-text shared strings корректно собираются из нескольких `<t>`-runs в порядке документа;
- для ячеек `t="s"` индекс общей строки валидируется fail-closed: отрицательные, дробные, нечисловые и выходящие за таблицу ссылки отклоняют XLSX с явной диагностикой вместо тихого значения `''`;
- валидная shared-string с пустым текстом остаётся допустимой; inline strings, обычные `str`, числа, даты и формулы не менялись;
- добавлен TDD regression на namespaced sharedStrings, rich-text concatenation и invalid/out-of-range indexes.

## 1.9.28 — 2026-08-29

- DELETE store-time freshness-check больше не вызывает полный `loadSnapshot()` перед каждой удаляемой строкой: используется targeted `CardGet` только конкретной row-card;
- общий `readMatrixRowFromCard` теперь используется и полным snapshot, и targeted DELETE recheck, поэтому raw fingerprint рассчитывается одной и той же логикой;
- targeted recheck явно подтверждает наличие живой `MatrixVersionID` в `MtxRouteMatrixRowVersions`; исчезнувшая версия fail-closed переводит DELETE в ПРОПУСТИТЬ;
- сохранены строгие проверки `RowCardID + MatrixVersionID + raw fingerprint` и локальный partial-apply без auto-merge; клиентское микроокно `CardGet → DeleteRow` остаётся задокументированным ограничением кастомного DELETE;
- добавлены TDD-regressions на отсутствие повторного full snapshot и исчезнувшую target-version.

## 1.9.27 — 2026-08-29

- UPDATE и ADD теперь отправляются через `CardStoreRequest` с `AffectVersion = true`: TESSA атомарно проверяет версию карточки во время Store и не позволяет молча затереть изменение, сделанное после preflight;
- перед ADD duplicate-validation повторяется непосредственно перед Store, чтобы строка-дубль, созданная другой сессией после preflight, не была записана;
- перед кастомным DELETE Studio заново читает матрицу и строго сверяет RowCardID, MatrixVersionID и raw fingerprint удаляемой строки; исчезнувшая или изменившаяся цель переводится в ПРОПУСТИТЬ;
- конфликт одной операции остаётся локальным: auto-merge не выполняется, зависимые destructive DELETE сохраняют fail-closed поведение, независимые безопасные строки могут продолжить применение;
- добавлены TDD-regressions для atomic Store version guard, post-preflight ADD duplicate race и post-preflight DELETE target race.

## 1.9.26 — 2026-08-29

- XLSX-reader сохраняет наличие и текст Excel-формулы в metadata рабочей ячейки; формулы в редактируемых критериях fail-closed переводят строку в ПРОПУСТИТЬ, cached `<v>` не применяется как обычное значение;
- строковый критерий, который Excel сериализовал как numeric cell, блокируется как потенциально преобразованный: исходное отображение могло потерять ведущие нули или измениться через scientific notation, проценты/дроби;
- number-format classifier различает built-in/custom `percent`, `scientific` и `fraction` наряду с `date`, `text` и `general`;
- настоящие Int/Decimal в General/Text и Date/DateTime Excel serial продолжают работать без новых ограничений;
- добавлен TDD regression pack для formula cached values и типовых Excel coercion-сценариев.
