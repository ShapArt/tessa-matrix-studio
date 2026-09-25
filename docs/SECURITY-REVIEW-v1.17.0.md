# Проверка безопасности v1.17.1

Объект проверки — production и UAT сборки TESSA Matrix Studio 1.17.1, XLSX/ZIP границы, Preview, запись через штатный API TESSA, диагностический пакет и корпоративная упаковка Manifest V3.

Полная матрица trust boundaries и внешних gates вынесена в [CERTIFICATION-CONTROLS.md](CERTIFICATION-CONTROLS.md). Базовый checklist — [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs); наличие checklist не заменяет независимую проверку ИБ и серверных ACL TESSA.

## Реализованные меры

- Production собирается без `__TESSA_MATRIX_SYNC_EXPORTS__` и `__TMS_FULL_UAT_V1__`. Внутренние функции записи доступны только в UAT профиле.
- Бизнес-данные Preview выводятся DOM-узлами через `textContent`. XSS payload в имени, значении, причине пропуска и подписи не создаёт исполняемые элементы или event-атрибуты.
- Значения Excel записываются как строки; начальные `=`, `+`, `-` и `@` не превращаются в формулы.
- Входной ZIP ограничен 32 MiB и 256 файлами; одна распакованная запись — 128 MiB, весь архив — 512 MiB, коэффициент сжатия — 100×. Проверяются traversal, XML структура и координаты SpreadsheetML.
- Диагностика формируется по allowlist-схеме. Сырые Card/TESSA response, cookies, токены и заголовки авторизации в обычный пакет не входят.
- Отдельный вручную запрошенный диагностический ZIP может содержать сырые карточки и ответы TESSA и явно маркируется `containsBusinessData=true`. Это чувствительный служебный материал: хранение, срок жизни и передача определяются корпоративной политикой ИБ. Пользовательский support ZIP остаётся очищенным.
- Кэш справочников разделён по origin, пользователю, шаблону, типу карточки и версии проекции; неизвестный пользователь отключает повторное использование. После релевантной записи кэш инвалидируется.
- Перед Apply повторно проверяются версия, контекст матрицы, ACL result, writer lock, identity строк и зависимости удаления. Лимит Apply — 2 000 операций, предупреждение — с 500.
- Manifest V3 пакет содержит локальный статический код, точные HTTPS origins и не запрашивает privileged permissions, background worker, remote code или `<all_urls>`.

## Обязательный серверный gate

Клиентская кнопка не является механизмом авторизации. Перед production служба ИБ/администратор TESSA должна под ограниченными учётными записями подтвердить серверный отказ для запрещённых `CardGet`, `CardNew`, `CardStore` и `Delete`, неизменность данных после отказа и наличие штатного аудита. Также проверяются смена прав и шаблона между Preview и Store, чужая матрица, stale version и writer lock.

Без этого протокола релиз блокируется native-evidence gate. Автоматические клиентские тесты не могут доказать корректность серверной ACL конкретного контура.

## Автоматические доказательства

- CodeQL JavaScript/TypeScript с блокировкой High/Critical;
- `npm audit --audit-level=high` и скан известных форматов секретов;
- XLSX/XML/ZIP, formula injection, DOM XSS/clobbering, stale context, cache isolation и диагностические секреты;
- Playwright Chromium: реальные клики, клавиатура, browser download, SHA-256 каждого файла пакета, распаковка Excel и десять циклов контроля heap;
- deterministic production/UAT build и GitHub artifact attestation.
- live evidence v1.17.1: `PASS 51 / FAIL 0 / NOT RUN 0`, 21/21 write receipts, 32/32 cleanup и verified restore; подробности без бизнес-данных — в [LIVE-UAT-AUDIT-v1.17.1.md](LIVE-UAT-AUDIT-v1.17.1.md).

Результат проверки не заменяет формальное заключение ИБ. Он фиксирует кодовые меры, воспроизводимые тесты и отдельные server-side gates, которые должен подтвердить владелец TESSA.
