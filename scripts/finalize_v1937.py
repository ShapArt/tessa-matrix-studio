from pathlib import Path

# Trigger after workflow creation; deterministic one-shot v1.9.37 finalizer.
VERSION_OLD = '1.9.36'
VERSION_NEW = '1.9.37'

def read(path): return Path(path).read_text(encoding='utf-8')
def write(path, text): Path(path).write_text(text, encoding='utf-8')
def once(text, old, new, label):
    if old not in text: raise SystemExit(f'{label} missing')
    return text.replace(old, new, 1)

p = 'tessa-matrix-studio.user.js'; s = read(p)
s = once(s, '// @version      1.9.36', '// @version      1.9.37', 'userscript metadata version')
s = once(s, "    version: '1.9.36',", "    version: '1.9.37',", 'APP version')
write(p, s)

p = 'README.md'; s = read(p)
s = once(s, 'version-1.9.36-EF233C', 'version-1.9.37-EF233C', 'README badge')
s = once(s, '**v1.9.36 · Автор: Шаповалов Артём**', '**v1.9.37 · Автор: Шаповалов Артём**', 'README header')
s = once(s, 'Подтвердите установку версии **1.9.36**', 'Подтвердите установку версии **1.9.37**', 'README install version')
s = once(s, 'Текущая версия: **1.9.36**', 'Текущая версия: **1.9.37**', 'README support version')
anchor = '> Начиная с **v1.9.36**, большой Preview можно превратить в контролируемый пакет без ручного отключения тысяч строк: блок **«Пакет для Apply»** оставляет первые `1 / 10 / 100 / 500 / 2000` операций из текущего фильтра **и текущего поиска**. Остальные операции используют обычный selective review и не попадают в Apply; **«Вернуть всё»** восстанавливает исходный план. Это не обходит operational guards — каждый реально применяемый пакет по-прежнему проходит свежий серверный preflight перед записью.\n'
note = anchor + '\n> [!NOTE]\n> Начиная с **v1.9.37**, Studio не форсирует полный `refreshCard()` сразу после Store/Delete: живой UAT показал, что нативный `TestMatrixView / MtxRouteMatrixDummyView` может в этот момент столкнуться с `MatrixRow.WriteHeartbit` writer-lock и показать системный HTTP 400 уже после успешной записи. После начавшейся записи старый Preview автоматически считается устаревшим и не может быть применён повторно. Диагностические JSON также больше не скачиваются автоматически: последний Apply/ErrorReport хранится в памяти вкладки и сохраняется только по явной кнопке **«Скачать отчёт»**.\n'
s = once(s, anchor, note, 'README v1.9.36 note')
s = once(s, '| **Применить к TESSA** | выполнить проверенный план изменений |\n| **Отмена** | остановить операцию, если текущий этап допускает отмену |',
              '| **Применить к TESSA** | выполнить проверенный план изменений |\n| **Скачать отчёт** | вручную сохранить последний Apply/ErrorReport JSON, если он нужен для диагностики |\n| **Отмена** | остановить операцию, если текущий этап допускает отмену |', 'README buttons')
write(p, s)

p = 'CHANGELOG.md'; s = read(p)
entry = '''# Changelog\n\n## 1.9.37 — 2026-08-31\n\n- живой Apply подтвердил успешную запись 13/13 операций, но после Store нативный `TestMatrixView / MtxRouteMatrixDummyView` дважды показывал HTTP 400 `ObtainWriterLock for MatrixRow.WriteHeartbit...`;\n- Studio больше не вызывает принудительный `editor.refreshCard()` сразу после Store/Delete, поэтому не инициирует лишний reload представления в чувствительном окне нативной writer-lock/heartbeat логики TESSA;\n- успешный/partial/cancelled Apply и необработанная ошибка больше не создают JSON-файлы автоматически: последний отчёт хранится в памяти вкладки и скачивается только вручную кнопкой **«Скачать отчёт»**;\n- после любой реально начатой mutation-операции текущий Preview/snapshot/bridge инвалидируются: старый план нельзя случайно применить повторно, следующий пакет начинается с новой проверки свежего состояния;\n- pre-write Stop (`startedCount=0`) по-прежнему не уничтожает безопасно проверенный план;\n- добавлены RED→GREEN regressions на отсутствие forced post-Apply refresh, opt-in diagnostics и consumption устаревшего Apply-plan; версия поднята до 1.9.37.\n\n'''
if not s.startswith('# Changelog\n\n'): raise SystemExit('CHANGELOG header missing')
s = entry + s[len('# Changelog\n\n'):]
write(p, s)

p = 'docs/PRODUCTION-RUNBOOK.md'; s = read(p)
old = '''После любого изменения:\n\n1. сохранить автоматически сформированный JSON-результат применения до завершения проверки;\n2. обновить карточку TESSA;\n3. скачать **новую** выгрузку Excel;\n4. проверить, что свежая выгрузка соответствует Preview;\n5. убедиться, что соседние/исходные строки не изменились;\n6. только после этого переходить к следующему сценарию.\n'''
new = '''После любого изменения:\n\n1. дождаться итогового статуса Studio;\n2. при необходимости диагностики нажать **«Скачать отчёт»** — JSON больше не создаётся автоматически;\n3. скачать **новую** выгрузку Excel либо вручную обновить страницу TESSA;\n4. проверить, что свежая выгрузка соответствует подтверждённому Preview;\n5. убедиться, что соседние/исходные строки не изменились;\n6. только после этого переходить к следующему сценарию.\n\nНачиная с v1.9.37 Studio намеренно **не вызывает принудительный `refreshCard()` сразу после Store/Delete**. Живой UAT показал, что нативный `TestMatrixView / MtxRouteMatrixDummyView` в этот момент может попытаться получить `MatrixRow.WriteHeartbit` writer-lock и показать HTTP 400, хотя сами Store уже завершились успешно. После первой начатой записи старый Preview автоматически инвалидируется и повторный Apply невозможен до новой проверки.\n'''
s = once(s, old, new, 'runbook post-Apply steps')
s = once(s, 'Studio автоматически скачивает `TESSA_Matrix_ErrorReport_*.json` для необработанной ошибки применения.',
              'Studio не скачивает диагностические JSON автоматически. После Apply или необработанной ошибки последний отчёт хранится только в памяти текущей вкладки; если он нужен для разбора, пользователь явно нажимает **«Скачать отчёт»**.', 'runbook error report')
write(p, s)

p = '.github/ISSUE_TEMPLATE/bug_report.yml'; s = read(p)
s = once(s, 'placeholder: 1.9.36', 'placeholder: 1.9.37', 'bug template version')
write(p, s)
