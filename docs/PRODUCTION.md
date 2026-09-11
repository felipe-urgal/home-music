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

## Dependências opcionais locais

O servidor continua funcional sem Whisper. Para habilitar manualmente o fallback local de lyrics do Assistente:

```dotenv
HOME_MUSIC_WHISPER_PATH=/usr/local/bin/whisper-cli
HOME_MUSIC_WHISPER_MODEL=/var/lib/home-music/models/ggml-base.bin
```

`HOME_MUSIC_WHISPER_PATH` deve ser um caminho absoluto para executável local e `HOME_MUSIC_WHISPER_MODEL` deve apontar para um modelo previamente instalado pelo operador. O Home Music **não baixa pesos automaticamente**. FFmpeg também precisa estar disponível por `HOME_MUSIC_FFMPEG_PATH` ou `PATH` para a preparação PCM.

O modelo pode consumir memória/CPU significativas conforme tamanho/hardware; CPU-only é suportado como baseline e nenhum tempo de conclusão é prometido. A capability administrativa informa quando binário/modelo/FFmpeg não estão disponíveis sem afetar scan, playback ou providers normais. Detalhes de segurança, scratch, limites e rollback: [`lyrics.md`](lyrics.md).

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

Os scripts internos do fluxo são invocados explicitamente via `bash`; o deploy não depende do bit executável do checkout para `scripts/install-systemd.sh`.

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

## Recovery de dados

Migrations SQLite são versionadas e executadas no startup. Depois de avanço incompatível de schema, não reduza `PRAGMA user_version` manualmente. Quando necessário, pare o serviço e restaure um backup compatível seguindo [`backup-restore.md`](backup-restore.md).

## Recovery de acesso administrativo

Se o acesso administrativo for perdido, use o recovery local suportado para uma conta existente, com o serviço parado:

```bash
sudo systemctl stop home-music
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
sudo systemctl start home-music
npm run prod:verify
```

O comando pode reativar/promover a conta e gerar uma senha temporária que exige troca no próximo login. Modelo de identidade e invariantes: [`multi-user-auth.md`](multi-user-auth.md).

## Fontes aprofundadas

- [`production-contract.md`](production-contract.md) — contrato consumido pelo Dev Dashboard;
- [`production.md`](production.md) — systemd, helper privilegiado e atualização;
- [`backup-restore.md`](backup-restore.md) — backup e restore;
- [`production-verification.md`](production-verification.md) — verificação funcional;
- [`multi-user-auth.md`](multi-user-auth.md) — identidade, sessões, autorização e recovery administrativo;
- [`lyrics.md`](lyrics.md) — LRCLIB, Whisper local opcional, persistência e rollback de lyrics.

Documentos da fase 7.5 foram preservados em [`history/phase-7.5/`](history/phase-7.5/) apenas como histórico de implementação; não devem ser usados como runbook atual.
