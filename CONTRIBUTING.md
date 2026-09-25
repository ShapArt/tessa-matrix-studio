# Разработка TESSA Matrix Studio

## Перед началом

- Используйте Node.js 24 и `npm ci --ignore-scripts --no-audit --no-fund`.
- Создавайте ветку от актуального `main`.
- Прочитайте [правила репозитория](AGENTS.md), [архитектуру](docs/ARCHITECTURE.md) и [стратегию тестирования](docs/TEST-STRATEGY.md).
- Не добавляйте Excel пользователей, сырые ответы TESSA, внутренние URL, ФИО, GUID карточек и диагностические ZIP. Локальные evidence хранятся только в игнорируемом `dist/private-evidence/`.

## Где менять код

| Задача | Канонический файл |
|---|---|
| Рабочая логика и интерфейс | `src/core.user.js` |
| Full UAT | `src/uat/full-uat.js` |
| Interval fallback | `src/runtime/interval-add-valid-fallback.js` |
| Сборка профилей | `tools/build-candidate.mjs` |
| Enterprise package | `tools/build-enterprise-package.mjs` |

Не редактируйте сгенерированный `tessa-matrix-studio.user.js`: `npm test` создаёт его из канонического `src/`. Старые hotfix и recovery-скрипты доступны в истории Git и не возвращаются в активную сборку.

## Проверка изменения

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd test
npm.cmd run build
```

Тесты перечислены в `tests/suite.json` и выполняются последовательно через `tools/run-test-suite.mjs`. Для production-дефекта сначала добавьте минимальный regression test, затем исправление. Для write-critical изменения нужны stateful contract test и актуальное native evidence согласно [TEST-STRATEGY.md](docs/TEST-STRATEGY.md).

## Pull request

В PR укажите:

1. конкретный дефект или пользовательский сценарий;
2. изменившееся поведение;
3. проверки и их результат;
4. влияние на безопасность, совместимость Excel и rollback;
5. необходимость live UAT.

Изменения production-кода, UAT и release workflow не объединяются при красном CI. Публичный релиз создаёт только `.github/workflows/release.yml`; UAT-профиль в production release не входит.

