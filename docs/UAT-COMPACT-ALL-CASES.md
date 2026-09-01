# Compact ALL-cases UAT

Актуально для **TESSA Matrix Studio v1.9.39**.

Этот UAT заменяет старую стратегию с тысячами однотипных искусственных строк. Нагрузка остаётся в автоматических regression-тестах, а ручной UAT проверяет отдельные пользовательские поведения: один сценарий = один понятный кейс.

## База

- Matrix format: `TESSA_MATRIX_ROUNDTRIP_V6`
- Fresh UAT MatrixID: `f5ec6fe5-55ce-49a7-9fdd-f24a6e7c11cb`
- TemplateID: `08d65ee3-4d2c-467b-97b2-c7ccb94723fc`
- Состояние: `Черновик`
- Активные сценарии располагаются в Excel rows `15–38`.
- Глобальные/destructive негативы выполняются **по одному на копии** workbook.

## Live evidence 2026-09-01

Реальный Apply на матрице `f5ec6fe5` подтвердил корректную запись всего mutation-plan: `requested=11`, `planned=11`, `started=11`, `applied=11`, `failed=0`, `notStarted=0`, `verificationIncomplete=false`. Отдельно planner до Apply исключил 12 source-invalid/stale строк.

Для v1.9.39 закреплены следующие ожидания:

- эти 12 source-skipped строк **не делают успешные 11/11 mutations частичным Apply**;
- успешный результат показывается как `completed / success=true`, а source-skipped выводятся отдельно как строки, не вошедшие в Apply;
- после Store обновляется только нативное отображение матрицы, без `editor.refreshCard()`;
- transient `ObtainWriterLock / WriteHeartbit` при refresh получает ограниченный retry, но не меняет успешный Store-result;
- если автообновление view не удалось, появляется ручная кнопка **Обновить отображение**;
- обычный успешный Apply показывается inline, без блокирующего browser `alert()`;
- progress/status закреплён сверху внутри прокручиваемого окна Studio;
- старый Apply-plan после начавшейся mutation остаётся consumed и повторно не применяется.

## Почему UAT разделён на ACTIVE / COPY / MANUAL / AUTO

`ACTIVE` сценарии совместимы между собой и могут одновременно находиться на листе `Матрица`.

`COPY` сценарии меняют workbook глобально или разрушают identity/архив. Их нельзя включать одновременно: например, wrong MatrixID намеренно блокирует весь workbook, а physical DELETE + новый no-ID ADD специально трактуется fail-closed как identity ambiguity.

`MANUAL` сценарии требуют интерактивного действия в UI/TESSA: selective review, package builder, Stop, concurrency, permissions, post-Apply поведение.

`AUTO` сценарии уже покрыты CI и нужны в ручном плане только как traceability: legacy V1–V5, 500/1000/5000 roundtrip, high-cardinality dictionaries, ZIP/XML/OPC security.

## ACTIVE: строки 15–38

| ID | Excel row | Сценарий | Ожидаемый Preview |
|---|---:|---|---|
| A01 | 15 | UPDATE одного справочника | ИЗМЕНИТЬ, 1 поле |
| A02 | 16 | UPDATE нескольких полей | ИЗМЕНИТЬ, несколько полей |
| A03 | 17 | NOOP | БЕЗ ИЗМЕНЕНИЙ |
| A04 | 18 | Boolean Нет → Да | ИЗМЕНИТЬ |
| A05 | 19 | Очистка optional-роли | ИЗМЕНИТЬ |
| A06 | 20 | Multivalue role 2 → 1 | ИЗМЕНИТЬ |
| A07 | 21 | Multivalue criterion 4 → 2 | ИЗМЕНИТЬ |
| A08 | 22 | Добавление optional-роли | ИЗМЕНИТЬ |
| A09 | 23 | REPLACE с сохранённой target identity | ЗАМЕНИТЬ |
| A10 | 24 | Boolean Да → Нет | ИЗМЕНИТЬ |
| A11 | 25 | Range `3 - 17` | ИЗМЕНИТЬ |
| A12 | 26 | Простой ADD | ДОБАВИТЬ |
| A13 | 27 | ADD с multivalue criteria | ДОБАВИТЬ |
| A14 | 28 | Fragment lookup без companion ID | ДОБАВИТЬ после однозначного resolve |
| A15 | 29 | Duplicate ADD | ПРОПУСТИТЬ |
| A16 | 30 | Unknown dictionary | ПРОПУСТИТЬ |
| A17 | 31 | Formula в editable criterion | ПРОПУСТИТЬ |
| A18 | 32 | Numeric coercion | ПРОПУСТИТЬ |
| A19 | 33 | Date coercion | ПРОПУСТИТЬ |
| A20 | 34 | Invalid boolean | ПРОПУСТИТЬ |
| A21 | 35 | Unknown role | ПРОПУСТИТЬ |
| A22 | 36 | ADD + range | ДОБАВИТЬ |
| A23 | 37 | ADD + boolean | ДОБАВИТЬ |
| A24 | 38 | ADD + multivalue role | ДОБАВИТЬ |

## COPY: глобальные и destructive негативы

Проверять по одному на отдельной копии свежего workbook.

- Physical DELETE одной baseline-строки.
- CLEAR существующей строки — не должен считаться DELETE.
- Потеря RowCardID / VersionID.
- Broken BaseFingerprint.
- Wrong MatrixID — один global blocker, без тысяч вторичных row-SKIP.
- Wrong TemplateID.
- Physical DELETE + новый no-ID ADD — fail-closed identity ambiguity.
- Formula/date coercion variants.
- ZIP traversal / ZIP64 / encrypted archive / decompression bomb.
- SpreadsheetML duplicate row/cell, XFE, malformed XML.
- OPC `TargetMode=External` / root escape.

## MANUAL: UI / Apply / concurrency

- Selective review отдельного поля UPDATE.
- `Не применять всю строку` для UPDATE.
- Исключение/возврат ADD и DELETE.
- Preview filters `Все / Изменить / Добавить / Удалить / Пропустить`.
- Preview search.
- `Пакет для Apply`: filter + search + размер 1/10/100/500/2000.
- 500 mutations: штатный Apply.
- 501–2000: дополнительное подтверждение.
- 2001+: Apply disabled заранее.
- DELETE guards: 9/50 allowed; 10/50 blocked by ratio; 100/1000 blocked absolutely.
- Stale UPDATE после Preview.
- ADD duplicate race.
- DELETE race.
- Stop до первой записи.
- Stop после начавшихся Store.
- Session expiry.
- Нет прав.
- Матрица не в редактируемом состоянии.
- Successful Store с native-view-only auto refresh и без full `refreshCard()`.
- Diagnostic JSON только по явной кнопке.
- Старый Apply-plan consumed после начавшейся записи.
- Fresh export reconciliation после Apply.
- `Актуализировать выбранный Excel`.
- `Скачать со свежими справочниками`.

## Минимальный live GOLD-проход

1. Убедиться, что Studio показывает `v1.9.39`.
2. Открыть UAT workbook на MatrixID `f5ec6fe5-55ce-49a7-9fdd-f24a6e7c11cb`.
3. Нажать **Проверить изменения**.
4. Убедиться, что нет global blocker и ACTIVE rows 15–38 классифицированы согласно каталогу.
5. Проверить filters/search/selective review.
6. Через **Пакет для Apply** оставить ровно **1 безопасную ADD или UPDATE**, без DELETE.
7. Apply должен завершиться `completed`, `success=true`; source-skipped строки отображаются отдельно и не отравляют результат.
8. Нативное отображение матрицы должно обновиться автоматически без full-card refresh; если writer-lock временный, Studio делает ограниченный retry.
9. После Store JSON не скачивается автоматически; старый Apply-plan недоступен; progress остаётся видимым при scroll.
10. Скачать fresh export и подтвердить, что изменилась только intended row.
11. На отдельной копии проверить wrong MatrixID: должен быть один global blocker, без row-noise.

## Release gate

Релиз/дальнейшее изменение production-кода блокируется при любом `P0 FAIL`.

Нагрузочные 500/1000/5000 и file-security regression не нужно вручную дублировать в каждом live UAT — они остаются обязательной частью CI.
