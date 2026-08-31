# Changelog

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
- rich-text runs корректно собираются из нескольких `<t>`-runs в порядке документа;
- битый `t="s"` index больше не превращается молча в пустую строку — XLSX отклоняется fail-closed;
- валидная реально пустая shared-string остаётся допустимой; inline strings, обычные `str`, числа, даты и формулы не менялись;
- добавлен TDD regression pack для namespaced sharedStrings, rich-text concatenation и invalid/out-of-range indexes.
