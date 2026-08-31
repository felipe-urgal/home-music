# Contrato operacional de produção

O Home Music expõe uma interface operacional padronizada para automação local e integração futura com o Dev Dashboard. Este contrato **não substitui** os runbooks existentes: `service:update`, backup/restore, systemd e `/ready` continuam sendo as fontes de verdade.

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
| `prod:deploy` | `service:update` | atualiza a instalação systemd existente |
| `prod:verify` | `GET http://127.0.0.1:8787/ready` | confirma readiness da instância ativa |
| `prod:logs` | journal do systemd | acompanha logs da instância ativa |

## Políticas declaradas

- provider: `systemd`;
- branch de produção: `main`;
- backup: obrigatório antes de migrations que alterem dados/schema conforme os runbooks atuais;
- migrations: executadas no startup;
- rollback após avanço incompatível de schema: restaurar backup compatível, nunca reduzir `PRAGMA user_version` manualmente.

## Segurança

O manifesto contém apenas metadados e nomes de scripts npm. Ele não contém senha, cookie, token, path secreto ou linha de shell arbitrária configurável pelo navegador.

Executar `prod:deploy` continua sendo uma mutação real de produção e deve exigir confirmação no futuro control plane. Para validação de PR/CI, use `prod:check`; não execute deploy, backup do banco real ou restart apenas para provar que o contrato existe.

## Relação com os runbooks

- instalação, update, systemd, health/readiness e Tailscale: [`production.md`](production.md);
- backup/restore: [`backup-restore.md`](backup-restore.md);
- identidade/migrations e recovery: [`phase-7.5-operations.md`](phase-7.5-operations.md).
