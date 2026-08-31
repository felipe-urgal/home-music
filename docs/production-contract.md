# Contrato operacional de produção

O Home Music expõe uma interface operacional padronizada para automação local e integração com o Dev Dashboard. Este contrato **não substitui** os runbooks existentes: `service:update`, backup/restore, systemd e `/ready` continuam sendo as fontes de verdade.

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

Mapeamento atual:

| Comando | Fonte de verdade | Efeito |
| --- | --- | --- |
| `prod:status` | `service:status` | leitura do estado do `home-music.service` |
| `prod:check` | typecheck + testes + build + smoke de produção | preflight sem alterar a instalação ativa |
| `prod:backup` | `backup:create` | cria e valida backup SQLite |
| `prod:deploy` | `service:update` | atualiza a instalação systemd existente usando o helper privilegiado já bootstrapado |
| `prod:verify` | `GET http://127.0.0.1:8787/ready` | confirma readiness da instância ativa |
| `prod:logs` | journal do systemd | acompanha logs da instância ativa |

## Políticas declaradas

- provider: `systemd`;
- branch de produção: `main`;
- backup: obrigatório antes de migrations que alterem dados/schema conforme os runbooks atuais;
- migrations: executadas no startup;
- rollback após avanço incompatível de schema: restaurar backup compatível, nunca reduzir `PRAGMA user_version` manualmente.

## Bootstrap privilegiado

`prod:deploy` foi desenhado para rodar com stdin fechado a partir de um control plane local. Por isso ele não depende de ticket sudo interativo nem recebe senha do dashboard.

O bootstrap administrativo é feito explicitamente, no terminal, por:

```bash
npm run service:install
```

Esse comando instala:

- `/etc/systemd/system/home-music.service`;
- `/usr/local/sbin/home-music-service-control`, root-owned e com catálogo fechado de `check`, `stop` e `restart` para `home-music.service`;
- `/etc/sudoers.d/home-music-<usuario>`, validado por `visudo` e limitado exatamente às três ações do helper com `NOPASSWD`.

Depois do bootstrap, `service:update`/`prod:deploy` executa `npm ci`, build e validações como o usuário normal e usa apenas `sudo -n /usr/local/sbin/home-music-service-control <ação>` nas transições privilegiadas. O helper não executa código do repositório como root, não aceita comando livre e não libera `systemctl` genérico.

Se helper ou sudoers não estiverem prontos, o update falha **antes** de parar o serviço e orienta executar `npm run service:install` no terminal. Alterações do unit, do caminho do Node ou do próprio helper também exigem novo `service:install`; o update comum não reescreve artefatos root-owned.

## Segurança

O manifesto contém apenas metadados e nomes de scripts npm. Ele não contém senha, cookie, token, path secreto ou linha de shell arbitrária configurável pelo navegador.

Executar `prod:deploy` continua sendo uma mutação real de produção e exige confirmação no control plane. A regra `NOPASSWD` não autoriza shell, `systemctl` arbitrário nem execução root de arquivos do projeto; ela autoriza somente o helper root-owned e suas ações fixas sobre `home-music.service`.

Para validação de PR/CI, use `prod:check`; não execute deploy, backup do banco real ou restart apenas para provar que o contrato existe.

## Relação com os runbooks

- instalação, update, systemd, helper privilegiado, health/readiness e Tailscale: [`production.md`](production.md);
- backup/restore: [`backup-restore.md`](backup-restore.md);
- identidade/migrations e recovery: [`phase-7.5-operations.md`](phase-7.5-operations.md).
