# Структура и сопровождение репозитория

## Активное дерево

```text
src/                канонический runtime, UAT и fallback
tests/              regression, contract, browser и security tests
tools/              действующие builder и evidence tools
deployment/         пример enterprise-конфигурации
release-evidence/   очищенные release attestations без бизнес-данных
docs/               актуальная документация
.github/workflows/  CI, UAT candidate, release и delivery canary
```

В активной ветке нет цепочки hotfix transforms. Все production и UAT артефакты детерминированно строятся `tools/build-candidate.mjs` из `src/`. Одноразовые recovery workflow, patch-скрипты и старые планы удалены из рабочего дерева; при расследовании старого релиза используйте его tag или Git history.

## Источники истины

| Данные | Источник |
|---|---|
| Версия | `package.json` |
| Production/UAT код | `src/` |
| Порядок тестов | `tests/suite.json` |
| Критическое покрытие | `tests/coverage-manifest.json` |
| Release assembly | `.github/workflows/release.yml` |
| Live evidence binding | `release-evidence/v<version>.json` |
| Откат | tag `v1.16.15`, commit `ad9f86e` |

Сгенерированный корневой userscript не хранится в Git. `npm test` создаёт UAT-файл локально перед тестами, а release workflow отдельно создаёт production-профиль в `dist/`.

## Действующие workflow

| Workflow | Назначение |
|---|---|
| `quality.yml` | regression, dependency/secret scan и CodeQL |
| `live-excel-preview-uat-candidate.yml` | exact UAT artifact для каждого релевантного PR |
| `uat-candidate.yml` | ручная сборка exact UAT по ref |
| `release.yml` | immutable production release после зелёного main |
| `delivery-canary.yml` | ежедневная проверка публичных latest assets и SHA-256 |

Новый временный workflow допустим только для расследования, удаляется в том же PR после переноса поведения в канонический код и тест.

## Регулярная уборка

Перед релизом и не реже одного раза в квартал:

1. проверить `git status` и отсутствие сгенерированных/частных файлов;
2. найти ссылки на удалённые документы и инструменты;
3. подтвердить, что каждый файл `tools/` вызывается тестом, workflow или документированным runbook;
4. проверить pin внешних GitHub Actions и `npm audit`;
5. выполнить `npm test` и deterministic build обоих профилей;
6. не переписывать release tags и опубликованные assets.

