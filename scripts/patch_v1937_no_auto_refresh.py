from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
old = """    setProgress(96, cancelled ? 'Фиксирую остановленную операцию' : 'Обновляю карточку TESSA', 'Получаю итоговое состояние');\n    try {\n      await bridge.refresh();\n    } catch (error) {\n      result.refreshError = String(error?.message || error || 'Не удалось обновить карточку TESSA после записи.');\n      result.verificationIncomplete = true;\n      log(`Изменения записаны, но итоговое обновление карточки TESSA завершилось ошибкой: ${result.refreshError}`, 'warn', error);\n    }\n    result.finishedAt = nowIso();\n"""
new = """    // Не форсим editor.refreshCard() сразу после Store/Delete. В маршрутной матрице\n    // нативный TestMatrixView при reload сам получает MatrixRow.WriteHeartbit writer-lock;\n    // немедленный full-card refresh после пачки записей создаёт лишнюю гонку блокировок\n    // и может показать системный 400/ObtainWriterLock, хотя сами Store уже успешны.\n    // Следующее чтение всегда начинается со свежей выгрузки/нового Preview.\n    setProgress(96, cancelled ? 'Фиксирую остановленную операцию' : 'Завершаю применение',\n      cancelled ? 'Сохраняю точную границу выполненных операций' : 'Запись завершена · карточка TESSA автоматически не перезагружается');\n    result.finishedAt = nowIso();\n"""
if old not in s:
    raise SystemExit('post-Apply refresh block not found')
s = s.replace(old, new, 1)
old2 = """    return `Готово.\\n\\nПрименено: ${applied}\\nПропущено: ${skipped}\\n\\nВсе подготовленные изменения применены.`;\n"""
new2 = """    return `Готово.\\n\\nПрименено: ${applied}\\nПропущено: ${skipped}\\n\\nВсе подготовленные изменения применены. Перед следующим пакетом скачайте свежий Excel или обновите страницу TESSA.`;\n"""
if old2 not in s:
    raise SystemExit('success result message not found')
s = s.replace(old2, new2, 1)
p.write_text(s, encoding='utf-8')
