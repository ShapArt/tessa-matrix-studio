# Контроли безопасности и сертификационный gate

Документ фиксирует реализованные меры TESSA Matrix Studio 1.17.1 и проверки, которые нельзя доказать только клиентским кодом. Он не является заявлением о формальной сертификации.

## Trust boundaries

| Граница | Реализованный контроль | Доказательство |
|---|---|---|
| XLSX/ZIP → parser | 32 МБ вход, 256 файлов, 128 МБ на запись, 512 МБ суммарно, ratio 100×, запрет traversal и внешних relationships | `xlsx-archive-security`, `xlsx-opc-relationships`, hostile UAT |
| XML/ячейки → planner | запрет DTD/entity, ограничение XML, отклонение формул, типизированное чтение | SpreadsheetML и formula-injection tests |
| Бизнес-текст → DOM | узлы и `textContent` для значений, тесты XSS/DOM clobbering | `enterprise-security-boundaries.cjs` |
| Справочники → пользователь | lean projection, CardTypeID scope, 30-минутный cache key по origin/user/template/type/projection | `scoped-catalogs-enterprise.mjs` |
| Preview → Apply | immutable plan context, stale/version checks, writer lock, server preflight | apply/preflight/reconciliation suites |
| Клиент → TESSA | штатный API текущей сессии; нет собственных credentials и обходного retry | ACL denial tests + обязательный live gate |
| Диагностика → ZIP | allowlist-сводки, без сырых карточек/ответов, SHA-256 manifest | support-bundle и redaction tests |
| Сборка → доставка | exact deterministic build, production без test globals, SHA-256, provenance, immutable release | release workflow и package tests |

Базой требований служит [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs). Привязка используется как checklist технической проверки, а не как автоматическое присвоение уровня соответствия.

## Память и отказоустойчивость

- Парсер выборочно распаковывает нужные листы; Full UAT может не удерживать архив после чтения.
- При смене файла и уходе страницы retained OPC parts удаляются из `WeakMap`.
- Blob URL отзывается после browser download; пакет собирается один раз после стабилизации Preview.
- Конкурентность CardGet/validation ограничена и адаптируется по `hardwareConcurrency` и `deviceMemory`.
- Длительная операция сохраняет только checkpoint этапа; после browser discard пользователь получает понятное восстановление, а не автоматический повтор записи.
- CI и Playwright проверяют high-cardinality книги, heap growth и десять циклов открыть → скачать → закрыть.

Принудительный JavaScript GC и `performance.memory` не используются как механизм корректности: они не являются переносимым контрактом браузера. Корректность обеспечивается ограничением объёма, снятием ссылок и явным освобождением Blob URL/OPC archive.

## Обязательные внешние gates

До production нужны отдельные доказательства:

1. Ограниченная учётная запись получает отказ сервера на запрещённые `CardGet`, `CardNew`, `CardStore` и DELETE.
2. Full UAT exact candidate завершён с `FAIL 0`, `NOT RUN 0`, пустым cleanup ledger и `restoreStatus=VERIFIED`.
3. Candidate SHA-256 совпадает с артефактом, который прошёл live UAT.
4. CodeQL, secret scan, dependency audit, locked install и enterprise package tests зелёные.
5. Production package не содержит `__TESSA_MATRIX_SYNC_EXPORTS__` и `__TMS_FULL_UAT_V1__`.
6. Подписанный CRX и закрытый ключ выпускаются ИТ в защищённом контуре; ключ не попадает в репозиторий или CI.
7. Pilot выполняется на тестовой группе, затем ограниченное production-кольцо, затем общий rollout.

Microsoft рекомендует оценивать permissions/host access расширений, тестировать в малой пилотной группе и раскатывать по фазам: [Manage Microsoft Edge extensions in the enterprise](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions). Для GPO используются `ExtensionSettings` или `ExtensionInstallForcelist`: [Use group policies to manage Microsoft Edge extensions](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-policies).

## Production и UAT

`npm run build:production` создаёт рабочий файл без тестовых exports и Full UAT. `npm run build:uat` создаёт exact UAT-кандидат с видимой кнопкой Full UAT. UAT устанавливается только в тестовом контуре и после испытаний заменяется production-сборкой того же исходного коммита.

Откат выполняется по [ROLLBACK-v1.16.15.md](ROLLBACK-v1.16.15.md). Корпоративная упаковка описана в [DEPLOYMENT-GPO-INTUNE.md](DEPLOYMENT-GPO-INTUNE.md).
