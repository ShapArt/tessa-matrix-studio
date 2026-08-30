from pathlib import Path


def patch(path_str, replacements):
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{path_str}: {label}: expected one match, found {count}')
        text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')

patch('README.md', [
    ('version-1.9.31-EF233C', 'version-1.9.32-EF233C', 'badge'),
    ('**v1.9.31 · Автор: Шаповалов Артём**', '**v1.9.32 · Автор: Шаповалов Артём**', 'hero version'),
    ('2. Подтвердите установку версии **1.9.31** в Tampermonkey.', '2. Подтвердите установку версии **1.9.32** в Tampermonkey.', 'quick start version'),
    ('- **Версия:** `1.9.31`', '- **Версия:** `1.9.32`', 'install version'),
    ('Текущая версия: **1.9.31**', 'Текущая версия: **1.9.32**', 'footer version'),
    (
        '> Начиная с **v1.9.31**, повторяющиеся fragment/not-found проверки во встроенных справочниках кэшируются в ограниченном per-catalog cache, поэтому одинаковая ошибка в сотнях строк Excel не пересканирует большой справочник для каждой строки. Индекс exact ID больше не дублирует одну запись при пустом `RoleTypeID`. Regression покрывает 25 000+ записей с export → import → plan и неоднозначными display names. XLSX-reader также учитывает OPC `TargetMode`: `External` fail-closed отклоняется даже при локально выглядящем `Target`, а безопасные internal/root-relative/dot-segment пути продолжают поддерживаться.\n\n---',
        '> Начиная с **v1.9.31**, повторяющиеся fragment/not-found проверки во встроенных справочниках кэшируются в ограниченном per-catalog cache, поэтому одинаковая ошибка в сотнях строк Excel не пересканирует большой справочник для каждой строки. Индекс exact ID больше не дублирует одну запись при пустом `RoleTypeID`. Regression покрывает 25 000+ записей с export → import → plan и неоднозначными display names. XLSX-reader также учитывает OPC `TargetMode`: `External` fail-closed отклоняется даже при локально выглядящем `Target`, а безопасные internal/root-relative/dot-segment пути продолжают поддерживаться.\n\n> [!NOTE]\n> Начиная с **v1.9.32**, большой Preview больше не ограничен первыми 40 операциями: доступны страницы, фильтры `Изменить / Добавить / Удалить / Пропустить` и поиск, поэтому selective review работает для любой операции плана. Для записи введён operational guard: до 500 мутаций Apply выполняется штатно, 501–2000 требуют дополнительного подтверждения, а более 2000 блокируются до обращения к TESSA. Удаление 100 и более строк одним пакетом также блокируется независимо от процента матрицы. Кнопка Stop завершает текущую границу безопасно: уже выполненные записи не откатываются, а JSON-результат фиксирует `applied / skipped / failed / notStarted`.\n\n> [!IMPORTANT]\n> В Roundtrip V6 физический DELETE и новые строки без MatrixRowID/MatrixVersionID нельзя смешивать в одном файле: такая комбинация неотличима от повреждения hidden identity и поэтому fail-closed блокируется. Выполняйте DELETE и ADD отдельными пакетами из свежих выгрузок.\n\n---',
        'v1.9.32 release notes'
    ),
])

patch('docs/PRODUCTION-RUNBOOK.md', [
    (
        'Начиная с v1.9.20 Preview выполняет read-only preflight на свежей TESSA. Поэтому невалидный справочник, дубль, stale-конфликт и зависимый DELETE должны быть видны до Apply как skip/blocker.\n\n## 4. Перед Apply',
        'Начиная с v1.9.20 Preview выполняет read-only preflight на свежей TESSA. Поэтому невалидный справочник, дубль, stale-конфликт и зависимый DELETE должны быть видны до Apply как skip/blocker.\n\nНачиная с v1.9.32 большой Preview просматривается постранично. Фильтры `Все / Изменить / Добавить / Удалить / Пропустить` и поиск применяются ко всему плану, а не только к текущей странице. Перед массовым Apply пользователь обязан проверить все релевантные страницы либо сузить план фильтром и selective review.\n\n## 4. Перед Apply',
        'preview paging'
    ),
    (
        'При наличии DELETE Studio запрашивает отдельное подтверждение. Не подтверждайте удаление только потому, что общий Preview выглядит знакомо — сначала откройте соответствующую строку Preview и проверьте identity/значения.\n\n## 5. После Apply',
        'При наличии DELETE Studio запрашивает отдельное подтверждение. Не подтверждайте удаление только потому, что общий Preview выглядит знакомо — сначала откройте соответствующую строку Preview и проверьте identity/значения.\n\nOperational limits v1.9.32:\n\n- до 500 mutation-операций — штатный Apply;\n- 501–2000 mutation-операций — обязательное дополнительное подтверждение большого пакета;\n- более 2000 mutation-операций — hard block до создания TESSA bridge; пакет нужно разделить;\n- 100 и более DELETE — hard block независимо от доли матрицы;\n- прежний ratio guard сохраняется: 10 и более DELETE при удалении не менее 20% исходной матрицы блокируются.\n\nВ Roundtrip V6 не объединяйте физический DELETE и новые строки без hidden identity в одном Excel. Missing baseline identity вместе с no-identity ADD намеренно fail-closed считается неоднозначностью. Для DELETE и ADD используйте отдельные свежие выгрузки.\n\n## 5. После Apply',
        'apply limits'
    ),
    (
        'Если Apply завершился частично, не повторяйте старый Apply вслепую. Скачайте свежее состояние и заново постройте Preview.\n\n## 6. Стоп-критерии',
        'Если Apply завершился частично, не повторяйте старый Apply вслепую. Скачайте свежее состояние и заново постройте Preview.\n\nКнопка Stop не является rollback. Уже завершённые `CardStore`/DELETE остаются в TESSA. Начиная с v1.9.32 итоговый JSON фиксирует точную границу: `status`, `plannedCount`, `startedCount`, `appliedCount`, `skippedCount`, `failedCount`, `notStartedCount` и `cancelled`. После `status=cancelled` продолжать старый план нельзя — нужна свежая выгрузка.\n\n## 6. Стоп-критерии',
        'cancel semantics'
    ),
    (
        '8. Release workflow повторно проверяет код и публикует immutable release;\n9. workflow проверяет публичные latest assets и SHA-256;\n10. Delivery Canary продолжает ежедневную проверку.\n\nПовторно публиковать существующую версию нельзя. Если release уже существует, нужно увеличивать версию, а не перезаписывать asset.',
        '8. Release workflow повторно проверяет код и публикует новый release;\n9. workflow проверяет публичные latest assets и SHA-256;\n10. Delivery Canary продолжает ежедневную проверку.\n\nCI запрещает повторную публикацию той же версии, но GitHub Release Immutability является отдельной настройкой репозитория. Перед production-релизом в **Settings → Releases** должна быть включена **Release Immutability**. Если она не включена, не называйте release immutable только на основании SHA-256/CI.\n\nПовторно публиковать существующую версию нельзя. Если release уже существует, нужно увеличивать версию, а не перезаписывать asset.',
        'release immutability accuracy'
    ),
    (
        'Можно вручную установить userscript из предыдущего immutable GitHub Release.',
        'Можно вручную установить userscript из предыдущего проверенного GitHub Release.',
        'rollback wording'
    ),
])

patch('CHANGELOG.md', [
    (
        '# Changelog\n\n## 1.9.31 — 2026-08-29',
        '# Changelog\n\n## 1.9.32 — 2026-08-30\n\n- Preview больших планов больше не ограничен первыми 40 действиями: добавлены постраничный просмотр, фильтры UPDATE/ADD/DELETE/SKIP и поиск по строке/значениям; selective review доступен для любой операции полного плана;\n- destructive DELETE guard дополнен абсолютным hard-stop: 100 и более удалений одним пакетом блокируются независимо от доли матрицы; существующий порог 10+ DELETE при >=20% матрицы сохранён;\n- Apply получил operational ceiling: 501–2000 мутаций требуют дополнительного подтверждения, более 2000 блокируются до создания TESSA bridge и любых TESSA-вызовов;\n- Stop во время Apply больше не теряет границу частичного выполнения: результат получает статусы `completed / partial / cancelled` и точные `planned/started/applied/skipped/failed/notStarted` счётчики без обещания rollback уже выполненных записей;\n- добавлен mega mixed-load regression: 500-row sanity, 1000-row UPDATE+ADD+SKIP, отдельный свежий physical DELETE пакет и 5000-row export → import → plan; на GitHub runner mega 5000 roundtrip занимает около 1.3 с, полный mega-suite около 1.9 с при ~80 MiB heap growth;\n- зафиксировано fail-closed правило V6: физический DELETE и новые no-identity ADD выполняются отдельными свежими пакетами, потому что их смешение может быть неотличимо от потери hidden MatrixRowID/MatrixVersionID;\n- production-runbook уточнён: GitHub Release Immutability — отдельная настройка репозитория, а не следствие SHA-256/CI; её необходимо включить вручную перед production release.\n\n## 1.9.31 — 2026-08-29',
        'changelog section'
    ),
])

patch('.github/ISSUE_TEMPLATE/bug_report.yml', [
    ('placeholder: 1.9.31', 'placeholder: 1.9.32', 'issue version'),
    ('        - Preview — не применять / вернуть изменение', '        - Preview — не применять / вернуть изменение\n        - Preview — большой план / фильтр / поиск / страницы\n        - Stop / partial / cancelled Apply\n        - Apply — слишком большой пакет / лимит операций', 'issue scenarios'),
])

print('Patched README, production runbook, changelog and issue template for 1.9.32')
