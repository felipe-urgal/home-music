# Produção

Este é o ponto de entrada canônico para operar a instalação de produção do Home Music.

## Contrato

A produção é command-driven e usa:

```text
provider: systemd
branch: main
runtime: Node/Fastify
configuração: .env
API/readiness: http://127.0.0.1:8787/ready
```

O ambiente de desenvolvimento é separado e não deve compartilhar SQLite, biblioteca ou configuração com produção. Veja [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Primeiro bootstrap

Depois de preparar `.env`, a instalação privilegiada inicial é explícita:

```bash
npm run service:install
```

Ela instala/atualiza o unit systemd e o helper privilegiado restrito usado pelos updates posteriores. Detalhes: [`production.md`](production.md).

## Fluxo canônico de atualização

Depois que a mudança estiver mergeada em `main` e a checkout local de produção estiver atualizada:

```bash
npm run prod:status
npm run prod:check
npm run prod:backup
npm run prod:deploy
npm run prod:verify
```

Use `prod:backup` antes de mudanças com risco de migration/schema/dados e sempre que a política operacional aplicável exigir. O manifesto declara backup obrigatório antes de migration.

### `prod:status`

Consulta o estado de `home-music.service` sem alterar a instalação.

### `prod:check`

Executa o gate normal de engenharia e acrescenta o smoke de produção:

```text
npm run check
-> npm run smoke:production
```

O preflight não deve substituir backup quando houver risco de dados.

### `prod:backup`

Cria um snapshot SQLite consistente usando o CLI de backup existente.

Para validar um artefato específico ou fazer restore, use os comandos especializados:

```bash
npm run backup:verify -- --artifact PATH
npm run backup:restore -- --artifact PATH --confirm-service-stopped
```

Restore é operação offline. Procedimento completo: [`backup-restore.md`](backup-restore.md).

### `prod:deploy`

Delega para `service:update`, o fluxo suportado de atualização da instalação systemd. Ele valida o bootstrap privilegiado, instala dependências/builda como usuário normal e usa somente o helper root-owned com catálogo fechado para as transições necessárias do serviço.

Não execute `service:install` em todo deploy; ele é o bootstrap/reconfiguração privilegiada quando unit/helper/política precisam mudar.

### `prod:verify`

Executa a verificação funcional da instância ativa. O readiness canônico é:

```text
GET http://127.0.0.1:8787/ready
```

Detalhes e overrides: [`production-verification.md`](production-verification.md).

### Logs

```bash
npm run prod:logs
```

## Tailscale

Tailscale Serve/Funnel é operação de exposição/acesso e permanece separado do deploy da aplicação:

```bash
npm run tailscale:status
npm run tailscale:public:status
npm run tailscale:hardening:status
```

Use os comandos `enable`/`disable` somente quando a mudança de perfil for intencional. Runbooks: [`tailscale.md`](tailscale.md), [`public-access.md`](public-access.md) e [`tailscale-hardening.md`](tailscale-hardening.md).

## Recovery

Migrations SQLite são versionadas e executadas no startup. Depois de avanço incompatível de schema, não reduza `PRAGMA user_version` manualmente. Quando necessário, pare o serviço e restaure um backup compatível seguindo o runbook.

## Fontes aprofundadas

- [`production-contract.md`](production-contract.md) — contrato consumido pelo Dev Dashboard;
- [`production.md`](production.md) — systemd, helper privilegiado e atualização;
- [`backup-restore.md`](backup-restore.md) — backup e restore;
- [`production-verification.md`](production-verification.md) — verificação funcional;
- [`phase-7.5-operations.md`](phase-7.5-operations.md) — identidade/migrations e recovery histórico ainda aplicável.
