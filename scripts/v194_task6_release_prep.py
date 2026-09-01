from pathlib import Path

VERSION_OLD = '1.9.39'
VERSION_NEW = '1.9.40'


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    return text.replace(old, new, 1)


# 1. Runtime/package version surfaces.
script_path = 'tessa-matrix-studio.user.js'
script = read(script_path)
script = replace_once(script, '// @version      1.9.39', '// @version      1.9.40', 'userscript @version')
script = replace_once(script, "    version: '1.9.39',", "    version: '1.9.40',", 'APP.version')
write(script_path, script)

package_path = 'package.json'
pkg = read(package_path)
pkg = replace_once(pkg, '"version": "1.9.39"', '"version": "1.9.40"', 'package version')
write(package_path, pkg)

# 2. Public README: user-facing contract only; no TESSA internal module IDs.
readme_path = 'README.md'
readme = read(readme_path)
for old, new, label in [
    ('version-1.9.39-', 'version-1.9.40-', 'README badge'),
    ('**v1.9.39 · Автор: Шаповалов Артём**', '**v1.9.40 · Автор: Шаповалов Артём**', 'README header version'),
    ('Подтвердите установку версии **1.9.39**', 'Подтвердите установку версии **1.9.40**', 'README quick-start version'),
    ('- **Версия:** `1.9.39`', '- **Версия:** `1.9.40`', 'README installation metadata version'),
    ('Текущая версия: **1.9.39**', 'Текущая версия: **1.9.40**', 'README support version'),
]:
    if old in readme:
        readme = readme.replace(old, new)

readme_anchor = '''Studio выполняет read-only проверку перед Preview и повторную свежую проверку перед записью. Небезопасные или конфликтующие операции переводятся в **ПРОПУСТИТЬ**, а большие планы можно просматривать, фильтровать и разбивать на контролируемые пакеты до 2000 операций.\n\n'''
readme_insert = '''Studio выполняет read-only проверку перед Preview и повторную свежую проверку перед записью. Небезопасные или конфликтующие операции переводятся в **ПРОПУСТИТЬ**, а большие планы можно просматривать, фильтровать и разбивать на контролируемые пакеты до 2000 операций.\n\n### Проверка среды и результата\n\nПеред работой Studio показывает состояние текущей web-среды TESSA: **«Среда: готова»**, **«Среда: ограничена»** или **«Среда: несовместима»**. Если отсутствует только необязательная возможность, блокируется только зависящая от неё операция: например, недоступность локального обновления отображения не запрещает безопасный Apply.\n\nПосле завершившегося Apply можно нажать **«Проверить результат»**. Эта проверка заново читает актуальное состояние TESSA и **ничего не записывает**. Успешная запись и подтверждение свежего состояния — два разных факта: `Apply completed` означает, что подготовленные операции завершились, а `verified` означает, что их ожидаемый результат дополнительно найден в свежем состоянии матрицы.\n\nЕсли проверка показывает расхождение или не может завершиться, Studio **не исправляет данные автоматически и не повторяет Apply**. Нужно разобраться в причине, получить свежую выгрузку/Preview и только затем принимать решение о следующих изменениях.\n\n'''
if readme_anchor not in readme:
    raise SystemExit('README user-contract anchor not found')
readme = readme.replace(readme_anchor, readme_insert, 1)

required_readme = [
    'version-1.9.40-',
    '**v1.9.40 · Автор: Шаповалов Артём**',
    'Подтвердите установку версии **1.9.40**',
    'Текущая версия: **1.9.40**',
    'Среда: готова',
    'Среда: ограничена',
    'Среда: несовместима',
    'Проверить результат',
]
for marker in required_readme:
    if marker not in readme:
        raise SystemExit(f'README required marker missing after patch: {marker}')
write(readme_path, readme)

# 3. Changelog: prepend actual v1.9.40 behavior.
changelog_path = 'CHANGELOG.md'
changelog = read(changelog_path)
changelog_header = '# Changelog\n\n'
if not changelog.startswith(changelog_header):
    raise SystemExit('CHANGELOG header mismatch')
entry = '''## 1.9.40 — 2026-09-01\n\n- добавлен read-only self-check текущей web-среды TESSA со статусами **«Среда: готова / ограничена / несовместима»**; недоступная необязательная возможность блокирует только зависящую от неё операцию, поэтому, например, отсутствие локального view-refresh не отключает безопасный Apply, а отсутствие создания строк блокирует ADD, но не UPDATE-only пакет;\n- runtime probe определяет доступные локальные API, открытую карточку, состояние матрицы и нативное представление без вызовов серверных `CardService.get/request/store/new/create`; локализованный Draft/Черновик распознаётся тем же production-инвариантом, что и обычный Apply;\n- после успешных UPDATE/ADD/DELETE Studio хранит только в памяти вкладки private mutation receipts: stable row/version identity и ID-first semantic hash ожидаемого typed-state; business/display-значения и receipt hash не добавляются в Apply JSON;\n- добавлена явная кнопка **«Проверить результат»**: она заново читает структуру и свежий snapshot TESSA, строго сверяет UPDATE/ADD по identity+semantic state, а DELETE — по отсутствию target identity в текущем membership; semantic nearest-match, повторный Store, rollback и автоматический repair запрещены;\n- reconciliation возвращает `verified / divergent / incomplete`, writer-lock получает не более 3 попыток с задержками 450/900 мс, остальные ошибки не ретраятся вслепую и не протаскивают сырой technical message в пользовательский результат;\n- fresh reconciliation индексирует snapshot один раз и работает O(N+M): regression 20 000 строк + 500 receipts выполняется примерно за десятки миллисекунд на GitHub runner;\n- добавлен privacy-safe support sanitizer по явному whitelist: версия, capability codes/scopes, счётчики Apply/reconciliation и reason codes; workbook/snapshot/receipts/logs/error/business values по умолчанию не могут попасть в такой объект, MatrixID/TemplateID добавляются только явно;\n- README, production runbook, compact UAT, issue-template и все release/version surfaces синхронизированы с `1.9.40`; merge/release остаются закрыты до exact-head Tests + CodeQL и controlled live UAT.\n\n'''
if '## 1.9.40 —' in changelog:
    raise SystemExit('CHANGELOG already contains 1.9.40')
changelog = changelog_header + entry + changelog[len(changelog_header):]
write(changelog_path, changelog)

# 4. Production runbook: capability scopes, receipt lifetime, strict reconciliation and privacy.
runbook_path = 'docs/PRODUCTION-RUNBOOK.md'
runbook = read(runbook_path)
runbook_before_anchor = '''## 2. Перед началом\n\n1. Открыть Tampermonkey и проверить, что включён только один экземпляр `TESSA Matrix Studio — Черкизово`.\n'''
runbook_before_insert = '''## 2. Перед началом\n\nНачиная с v1.9.40 сначала посмотрите строку совместимости в закреплённом status-блоке Studio:\n\n- **Среда: готова** — обязательные возможности для текущей карточки доступны;\n- **Среда: ограничена** — отсутствует необязательная возможность, блокируется только зависимая операция;\n- **Среда: несовместима** — отсутствует обязательный read/write primitive или надёжный контекст открытой матрицы, соответствующая операция должна fail-closed остановиться.\n\nCapability gate считается **по фактически выбранным операциям**. Отсутствие возможности создать новую строку блокирует ADD, но не UPDATE-only Apply; отсутствие локального refresh представления не отменяет успешно записанные изменения и не запрещает Apply. Кнопка **«Повторить проверку»** перечитывает только локальные возможности текущей web-сессии и не делает Store/Delete.\n\n1. Открыть Tampermonkey и проверить, что включён только один экземпляр `TESSA Matrix Studio — Черкизово`.\n'''
if runbook_before_anchor not in runbook:
    raise SystemExit('Runbook section 2 anchor not found')
runbook = runbook.replace(runbook_before_anchor, runbook_before_insert, 1)

after_apply_anchor = '''Начиная с v1.9.37 Studio намеренно **не вызывает принудительный `refreshCard()` сразу после Store/Delete**. Живой UAT показал, что нативный `TestMatrixView / MtxRouteMatrixDummyView` в этот момент может попытаться получить `MatrixRow.WriteHeartbit` writer-lock и показать HTTP 400, хотя сами Store уже завершились успешно. После первой начатой записи старый Preview автоматически инвалидируется и повторный Apply невозможен до новой проверки.\n\n'''
after_apply_insert = '''Начиная с v1.9.37 Studio намеренно **не вызывает принудительный `refreshCard()` сразу после Store/Delete**. Живой UAT показал, что нативное представление в этот момент может быть занято writer-lock, хотя сами Store уже завершились успешно. После первой начатой записи старый Preview автоматически инвалидируется и повторный Apply невозможен до новой проверки.\n\n### Read-only проверка результата в v1.9.40\n\nПосле реально завершившихся mutation-операций Studio хранит **только в памяти текущей вкладки** private receipt-контекст. Он содержит plan/matrix/template identity и по одной записи на успешно завершённый UPDATE/ADD/DELETE. Для UPDATE/ADD сохраняется stable target identity и hash ожидаемого ID-first typed-state; для DELETE — target row/version identity. Receipts не восстанавливаются после перезагрузки вкладки и не добавляются в обычный Apply JSON.\n\nКнопка **«Проверить результат»** выполняет отдельное fresh read и не является продолжением Apply:\n\n- `verified` — все проверяемые receipts подтверждены;\n- `divergent` — найдена семантическая разница, ожидаемая строка исчезла либо DELETE-target всё ещё присутствует в текущем membership;\n- `incomplete` — часть результата нельзя доказать по identity или fresh read не завершился.\n\nUPDATE/ADD подтверждаются только по точной RowCardID/VersionID identity и ожидаемому semantic hash. **Semantic nearest-match запрещён**: похожая строка не может быть принята за созданную/обновлённую. DELETE считается подтверждённым только когда обе сохранённые target identity отсутствуют в свежем membership; если тот же RowCardID остался с другой версией, результат divergent.\n\nFresh snapshot индексируется один раз по RowCardID и VersionID; последующая сверка receipts работает O(N+M), без полного `.find()` по snapshot для каждой операции.\n\nПри transient writer-lock reconciliation делает максимум **3 попытки**: сразу, затем через **450 мс**, затем через **900 мс**. Другие ошибки не ретраятся вслепую. Reconciliation никогда не делает Store/Delete, не вызывает rollback и не пытается автоматически исправить `divergent`/`incomplete`; следующий write начинается только с нового Preview.\n\n'''
if after_apply_anchor not in runbook:
    raise SystemExit('Runbook after-Apply anchor not found')
runbook = runbook.replace(after_apply_anchor, after_apply_insert, 1)

privacy_anchor = '''Studio не скачивает диагностические JSON автоматически. После Apply или необработанной ошибки последний отчёт хранится только в памяти текущей вкладки; если он нужен для разбора, пользователь явно нажимает **«Скачать отчёт»**.\n\n'''
privacy_insert = '''Studio не скачивает диагностические JSON автоматически. После Apply или необработанной ошибки последний отчёт хранится только в памяти текущей вкладки; если он нужен для разбора, пользователь явно нажимает **«Скачать отчёт»**.\n\nДля отдельного support-объекта v1.9.40 действует whitelist: версия Studio, capability `code/scope`, счётчики Apply, счётчики/status/reason codes reconciliation. Workbook, snapshot, private receipts/hash, raw logs/error и business/display values туда не копируются. MatrixID/TemplateID допускаются только при явном `includeIds=true` и только во внутреннем безопасном канале. Это отдельный безопасный формат; обычный Apply JSON не был переопределён этой функцией.\n\n'''
if privacy_anchor not in runbook:
    raise SystemExit('Runbook privacy anchor not found')
runbook = runbook.replace(privacy_anchor, privacy_insert, 1)
write(runbook_path, runbook)

# 5. Compact UAT: current version + exact CAP/REC/PRIV cases + gold flow.
uat_path = 'docs/UAT-COMPACT-ALL-CASES.md'
uat = read(uat_path)
uat = replace_once(uat, 'Актуально для **TESSA Matrix Studio v1.9.39**.', 'Актуально для **TESSA Matrix Studio v1.9.40**.', 'UAT current version')

gold_marker = '## Минимальный live GOLD-проход\n\n'
cases = '''## v1.9.40: capability / reconciliation / privacy\n\n| ID | Сценарий | Ожидаемый результат |\n|---|---|---|\n| CAP-01 | Полная поддерживаемая среда | `Среда: готова`; Export / Analyze / нужный Apply доступны |\n| CAP-02 | Нет локального refresh представления | `Среда: ограничена`; Apply остаётся доступен, refresh блокируется отдельно |\n| CAP-03 | Нет возможности создавать строки | ADD blocked; UPDATE-only Apply остаётся доступен |\n| REC-01 | Один безопасный UPDATE → Проверить результат | exact target identity + semantic state → `verified` |\n| REC-02 | Один безопасный ADD → Проверить результат | созданная exact identity + semantic state → `verified` |\n| REC-03 | DELETE на отдельной test-copy | сохранённые target IDs отсутствуют в current membership → `verified` |\n| REC-04 | После Apply изменить ту же строку внешне до проверки | `divergent`; reconciliation делает **0 Store/Delete** и ничего не чинит автоматически |\n| REC-05 | Fresh read дважды получает transient writer-lock | максимум 3 попытки: сразу / +450 мс / +900 мс; затем user-visible incomplete/manual retry |\n| PRIV-01 | Privacy fixture support sanitizer | нет business values, workbook/snapshot, raw error/logs, receipts/hash; ID только при явном включении |\n\n'''
if gold_marker not in uat:
    raise SystemExit('UAT GOLD marker not found')
uat = uat.replace(gold_marker, cases + gold_marker, 1)

old_gold = '''1. Убедиться, что Studio показывает `v1.9.39`.\n2. Открыть UAT workbook на MatrixID `f5ec6fe5-55ce-49a7-9fdd-f24a6e7c11cb`.\n3. Нажать **Проверить изменения**.\n4. Убедиться, что нет global blocker и ACTIVE rows 15–38 классифицированы согласно каталогу.\n5. Проверить filters/search/selective review.\n6. Через **Пакет для Apply** оставить ровно **1 безопасную ADD или UPDATE**, без DELETE.\n7. Apply должен завершиться `completed`, `success=true`; source-skipped строки отображаются отдельно и не отравляют результат.\n8. Нативное отображение матрицы должно обновиться автоматически без full-card refresh; если writer-lock временный, Studio делает ограниченный retry.\n9. После Store JSON не скачивается автоматически; старый Apply-plan недоступен; progress остаётся видимым при scroll.\n10. Скачать fresh export и подтвердить, что изменилась только intended row.\n11. На отдельной копии проверить wrong MatrixID: должен быть один global blocker, без row-noise.\n'''
new_gold = '''1. Убедиться, что Studio показывает `v1.9.40` и статус среды соответствует ожидаемому; для обычной полной среды — **`Среда: готова`**.\n2. Открыть UAT workbook на MatrixID `f5ec6fe5-55ce-49a7-9fdd-f24a6e7c11cb`.\n3. Нажать **Проверить изменения**.\n4. Убедиться, что нет global blocker и ACTIVE rows 15–38 классифицированы согласно каталогу.\n5. Проверить filters/search/selective review.\n6. Через **Пакет для Apply** оставить ровно **1 безопасную ADD или UPDATE**, без DELETE.\n7. Apply должен завершиться `completed`, `success=true`; source-skipped строки отображаются отдельно и не отравляют результат; старый Preview consumed.\n8. Нажать **Проверить результат**. Ожидание первого прохода: `verified=1`. В Network/логах браузера не должно появиться нового Store/Delete из-за reconciliation.\n9. Нативное отображение матрицы может обновляться отдельно без full-card refresh; transient writer-lock обрабатывается bounded retry и не меняет уже завершённый Store-result.\n10. После Store JSON не скачивается автоматически; progress остаётся видимым при scroll.\n11. Скачать fresh export и вручную подтвердить, что изменилась только intended row.\n12. На отдельной test-copy после безопасного Apply изменить ту же строку другим штатным способом и затем нажать **Проверить результат**: ожидание `divergent=1`, **0 автоматических исправлений / повторных Store**.\n13. Прогнать PRIV-01 и убедиться, что support sanitizer не содержит business values.\n14. На отдельной копии проверить wrong MatrixID: должен быть один global blocker, без row-noise.\n'''
if old_gold not in uat:
    raise SystemExit('UAT old GOLD flow not found')
uat = uat.replace(old_gold, new_gold, 1)
write(uat_path, uat)

# 6. Public issue template version + explicit reconciliation scenario.
issue_path = '.github/ISSUE_TEMPLATE/bug_report.yml'
issue = read(issue_path)
issue = replace_once(issue, 'placeholder: 1.9.39', 'placeholder: 1.9.40', 'issue version placeholder')
operation_anchor = '        - Apply — обновление отображения после записи\n'
if operation_anchor in issue and 'Проверка результата после Apply' not in issue:
    issue = issue.replace(operation_anchor, operation_anchor + '        - Проверка результата после Apply\n', 1)
write(issue_path, issue)

print('v1.9.40 release-prep patch applied')
