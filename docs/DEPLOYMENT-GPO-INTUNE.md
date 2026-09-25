# Корпоративное развёртывание через Edge, GPO и Intune

## Пакет

Production userscript собирается командой `npm run build:production`. Корпоративная оболочка создаётся только из этого exact-файла:

```powershell
node tools/build-enterprise-package.mjs dist/tessa-matrix-studio.user.js enterprise-config.json dist/enterprise-unsigned
```

Минимальный config для пилота:

```json
{
  "origins": [
    "https://tessa-app01tl.cherkizovsky.net",
    "https://tessa-app01.cherkizovsky.net",
    "https://tessa.cherkizovsky.net"
  ]
}
```

Builder создаёт Manifest V3 с точными host patterns и без дополнительных permissions. Подпись CRX выполняет ИТ в защищённом контуре: закрытый ключ не хранится в репозитории или CI. Для управляемого обновления config должен содержать выданный Edge extension ID, корпоративные HTTPS `updateUrl` и `crxUrl`; тогда пакет также создаёт `update.xml` и заготовки policy.

## Кольца

1. **Pilot** — тестовая группа, тестовый TESSA контур, Fast UAT и один Live smoke с восстановлением.
2. **Production limited** — небольшая бизнес-группа, мониторинг ошибок и времени операций не менее одного рабочего дня.
3. **Production** — обязательная установка через `ExtensionSettings` или `ExtensionInstallForcelist` после ACL gate и Certification UAT.

В Intune используйте Administrative Templates для Microsoft Edge или импортированный ADMX. В GPO задайте force-installed extension и корпоративный update URL. Запретите пользователю менять источник обновления. Перед раскаткой сверьте SHA-256 `studio.js`, CRX и published manifest с утверждённой заявкой.

## Обновление и откат

- Версия задаётся только в `package.json`; production, manifest, ZIP и отчёты получают её из канонического builder.
- Публикация версии неизменяема: workflow не перезаписывает существующий release и создаёт attestation по `SHA256SUMS.txt`.
- Для отката назначьте предыдущий подписанный CRX версии 1.16.15 тем же extension ID и update URL либо временно закрепите эту версию политикой. Точный userscript 1.16.15 имеет SHA-256 `AF0F7D3E4B240A9F5BF35F736920AAB67C2D1A89D7BA6B67EAEBF2A9771AFECF`; исходная точка — tag `v1.16.15`, commit `ad9f86e`.
- После отката очистите кэш расширения/страницы, заново откройте карточку и выполните read-only smoke. Откат не должен повторно применять Excel-файл.

Подробный порядок отката и контрольные суммы: [ROLLBACK-v1.16.15.md](ROLLBACK-v1.16.15.md).
