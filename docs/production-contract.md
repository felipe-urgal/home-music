# Contrato operacional de produção

O Home Music expõe uma interface operacional padronizada para automação local e integração com o Dev Dashboard. A entrada canônica para operação é [`PRODUCTION.md`](PRODUCTION.md); este documento detalha o contrato consumido pela automação.

O manifesto versionado fica em:

```text
.dev-dashboard/production.json
```

## Comandos canônicos

```bash
npm run prod:status
npm run prod:check
npm run prod:backup
npm run prod:deploy
npm run prod:verify
npm run prod:logs
```

| Comando | Fonte de verdade | Efeito |
| --- | --- | --- |
| `prod:status` | `service:status` | leitura do estado de `home-music.service` |
| `prod:check` | `check` + `smoke:production` | preflight sem alterar a instalação ativa |
| `prod:backup` | `backup:create` | cria e valida backup SQLite |
| `prod:deploy` | `service:update` | atualiza a instalação systemd existente |
| `prod:verify` | verificador de produção / `/ready` | confirma a instância ativa |
| `prod:logs` | journal do systemd | acompanha logs da instância ativa |

O gate normal de engenharia é `npm run check`; `prod:check` acrescenta o smoke específico de produção. Benchmarks, E2E, regressões de segurança, contratos shell e smoke de backup/restore permanecem direcionados por risco e não são adicionados implicitamente ao preflight.

## Políticas declaradas

- provider: `systemd`;
- branch de produção: `main`;
- backup: obrigatório antes de migrations que alterem dados/schema conforme o runbook;
- migrations: executadas no startup;
- rollback após avanço incompatível de schema: restaurar backup compatível, nunca reduzir `PRAGMA user_version` manualmente.

## Bootstrap privilegiado

`prod:deploy` foi desenhado para rodar com stdin fechado a partir de um control plane local. Ele não depende de ticket sudo interativo nem recebe senha do dashboard.

O bootstrap administrativo é feito explicitamente, no terminal, por:

```bash
npm run service:install
```

Esse comando instala:

- `/etc/systemd/system/home-music.service`;
- `/usr/local/sbin/home-music-service-control`, root-owned e com catálogo fechado de `check`, `stop` e `restart` para `home-music.service`;
- regra sudoers limitada às ações do helper.

Depois do bootstrap, `service:update`/`prod:deploy` instala dependências, builda e valida como usuário normal e usa apenas o helper root-owned nas transições privilegiadas. O helper não executa código do repositório como root, não aceita comando livre e não libera `systemctl` genérico.

Se helper ou sudoers não estiverem prontos, o update falha antes de parar o serviço e orienta executar `npm run service:install`. Alterações do unit, caminho do Node ou próprio helper também exigem novo bootstrap.

## Segurança

O manifesto contém somente metadados e nomes de scripts npm. Ele não contém senha, cookie, token, path secreto ou linha de shell arbitrária configurável pelo navegador.

Executar `prod:deploy` continua sendo uma mutação real de produção e exige confirmação no control plane. Para validação de PR/CI, use `npm run check`; para preflight de uma atualização real, use `prod:check`. Não execute deploy, backup real ou restart somente para provar que o contrato existe.

## Relação com os runbooks

- receita operacional: [`PRODUCTION.md`](PRODUCTION.md);
- instalação/update, systemd, helper e Tailscale: [`production.md`](production.md);
- backup/restore: [`backup-restore.md`](backup-restore.md);
- identidade/migrations e recovery: [`phase-7.5-operations.md`](phase-7.5-operations.md).
