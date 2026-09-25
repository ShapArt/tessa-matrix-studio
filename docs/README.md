# Документация

Документы сгруппированы по задаче. Актуальная production-версия — 1.17.1; история изменений хранится в [CHANGELOG](../CHANGELOG.md), тегах и Git history.

## Пользователю

- [Установка и работа](../README.md)
- [Алгоритмы ADD, UPDATE, DELETE и копирования строк](CHANGE-ALGORITHMS.md)
- [Диагностика Studio](STUDIO-DIAGNOSTICS.md)
- [Проверка дубликатов](DUPLICATE-CHECK-DIAGNOSTICS.md)

## Разработчику

- [Как внести изменение](../CONTRIBUTING.md)
- [Архитектура и границы компонентов](ARCHITECTURE.md)
- [Карта канонического кода](CODE-MAP.md)
- [Стратегия и уровни тестирования](TEST-STRATEGY.md)
- [Структура и сопровождение репозитория](REPOSITORY-MAINTENANCE.md)
- [Контракт native row payload](NATIVE-ROW-PAYLOAD.md)
- [Интервальная диагностика](INTERVAL-DIAGNOSTICS.md)

## ИТ, эксплуатация и ИБ

- [Production runbook](PRODUCTION-RUNBOOK.md)
- [Развёртывание через GPO и Intune](DEPLOYMENT-GPO-INTUNE.md)
- [Enterprise package](ENTERPRISE-DEPLOYMENT-RU.md)
- [Контроли сертификации](CERTIFICATION-CONTROLS.md)
- [Security review 1.17](SECURITY-REVIEW-v1.17.0.md)
- [Политика безопасности](../SECURITY.md)
- [Rollback на 1.16.15](ROLLBACK-v1.16.15.md)

## QA и доказательства релиза

- [UAT 1.17](UAT-v1.17.0.md)
- [Компактная матрица всех сценариев](UAT-COMPACT-ALL-CASES.md)
- [Аудит live UAT 1.17.1](LIVE-UAT-AUDIT-v1.17.1.md)
- [Аудит copied-row Preview](COPIED-ROW-PREVIEW-AUDIT-2026-09-24.md)
- [Аудит server paging](PAGING-RUNTIME-AUDIT-2026-09-23.md)

Документы прошлых реализаций не дублируются в активном дереве. Они доступны по соответствующему release tag, включая неизменяемый rollback tag `v1.16.15`.

