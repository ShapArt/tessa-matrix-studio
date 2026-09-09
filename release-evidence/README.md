# Native TESSA release evidence

Начиная с релизов после введения этого gate публикация production userscript должна быть привязана к живому UAT в TESSA, а не только к synthetic CI.

## Процесс

1. Подготовить релизную ветку и выставить новую версию в `package.json` / userscript.
2. Запустить workflow **UAT Candidate** для точного branch/tag/commit ref.
3. Скачать artifact `tessa-matrix-studio-uat-v<version>-<run_id>` и установить именно `tessa-matrix-studio.user.js` из него.
4. На тестовой матрице снять два отдельных recorder-файла:
   - штатный DELETE одной тестовой строки;
   - штатное сохранение основной карточки после DELETE.
5. Создать attestation локально:

```bash
node tools/create-native-evidence-attestation.mjs \
  <version> \
  <candidate>/tessa-matrix-studio.user.js \
  TESSA_Native_Delete.json \
  TESSA_Native_Save.json \
  release-evidence/v<version>.json
```

6. Закоммитить только нормализованный `release-evidence/v<version>.json`. Сырые recorder-файлы не публикуются в репозитории.
7. После merge Release workflow собирает public userscript заново и **до публикации** запускает `tools/release-native-evidence-gate.mjs` против `dist/tessa-matrix-studio.user.js`.

Если built userscript отличается хотя бы одним байтом от кандидата, который прошёл UAT, SHA-256 не совпадёт и релиз остановится. Отсутствующий, устаревший или `unverified` attestation также блокирует публикацию.

## Что доказывает attestation

Attestation фиксирует только технические факты: версию, SHA-256 точного userscript, SHA-256 двух локальных recorder-файлов, нативный `DeleteRow` request type, успешный Store/Get, отсутствие truncation и безопасное восстановление recorder hooks. Бизнес-значения и сырые recorder-файлы в GitHub не сохраняются.
