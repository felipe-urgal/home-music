# Home Music

Servidor pessoal de música para transformar uma pasta local em uma biblioteca de streaming acessível pelo navegador, celular, PWA, Android TV/boxes e clientes OpenSubsonic compatíveis.

O Home Music usa **React + TypeScript + Vite** no frontend e **Fastify + TypeScript + SQLite** no backend. Em produção, um único processo Fastify serve API, frontend compilado, capas, streaming de áudio e o adapter OpenSubsonic.

> O Home Music é self-hosted. Não exponha a porta `8787` diretamente à internet. Para acesso remoto, prefira Tailscale Serve + HTTPS; Funnel é uma opção pública explícita quando necessária.

## Principais recursos

- biblioteca local com scanner incremental, busca, pastas, artistas, álbuns, favoritos e playlists;
- player com fila, shuffle/repeat, ReplayGain, streaming HTTP Range, Media Session e retomada persistida;
- PWA com shell offline, downloads isolados por usuário, playlists/pastas offline deduplicadas e cold start manifest-first;
- Home Music TV com APK Android, GeckoView embarcado, layout 16:9 dedicado, D-pad/OK e compatibilidade em validação no BTV 11;
- múltiplas contas com papéis `admin`/`user`, sessões, troca de senha e portabilidade dos dados pessoais;
- Administração para biblioteca, metadata, integridade, lixeira/quarentena, importação, usuários e Assistente da Biblioteca;
- Assistente da Biblioteca com MusicBrainz, Cover Art Archive, LRCLIB, normalização assistida, revisão individual/em lote e automação opt-in;
- fallback opcional para casos difíceis com Chromaprint/AcoustID e transcrição/alinhamento local de lyrics com Whisper/whisper.cpp;
- resolução única de lyrics para player, offline e OpenSubsonic, com overrides gerenciados, sidecars e rollback;
- fallback canônico de artwork reutilizado na biblioteca, player e Media Session, com materialização local explícita quando desejada;
- importação por upload, URL e providers externos com staging, validação e promoção segura para `MUSIC_DIR`;
- descoberta/importação via Jamendo com política fail-closed de licença/download;
- adapter OpenSubsonic sobre biblioteca, streaming e estado pessoal existentes, com API keys revogáveis por usuário;
- FFmpeg/FFprobe para compatibilidade, transcode, validação técnica e preparação local de áudio para jobs opcionais;
- SQLite versionado, backup/restore e operação systemd;
- acesso remoto via Tailscale Serve e Funnel opcional.

## Arquitetura

```text
Browser / PWA / Android TV / cliente OpenSubsonic
      |
      v
React / Vite (DEV) ou /rest/*
      |
      v
Fastify
  |   |   |
  |   |   +--> streaming / FFmpeg / importação / jobs locais
  |   +------> SQLite
  +----------> MUSIC_DIR
```

Em produção, o frontend compilado é servido pelo próprio Fastify. OpenSubsonic, o Assistente, o modo offline e o cliente TV reutilizam as mesmas autoridades de biblioteca e dados; não existe um segundo catálogo canônico. Mais detalhes: [`docs/architecture.md`](docs/architecture.md).

## Requisitos

Obrigatórios para o fluxo normal:

- Ubuntu/Linux para o fluxo operacional suportado;
- Node.js 22 ou superior;
- npm;
- uma pasta local para a biblioteca de áudio.

Recomendados/opcionais conforme a capacidade usada:

- FFmpeg/FFprobe para compatibilidade, transcode e validação;
- Tailscale para acesso remoto;
- `yt-dlp` para providers que dependem dele;
- `HOME_MUSIC_JAMENDO_CLIENT_ID` para descoberta/importação Jamendo;
- `fpcalc` + configuração AcoustID para identificação acústica opcional;
- `whisper.cpp` + modelo local para transcrição/alinhamento opcional de lyrics.

Nenhum provider pago ou modelo Whisper é requisito para o happy path. O Home Music não baixa modelo Whisper automaticamente.

## Desenvolvimento

O ambiente DEV é separado da instalação systemd de produção.

```bash
npm ci
cp .env.development.example .env.development
mkdir -p music-dev data/development
npm run dev
```

Antes do primeiro start, configure uma senha temporária exclusiva de DEV em `.env.development`.

Endereços padrão:

```text
Web: http://localhost:5173
API: http://127.0.0.1:8788
```

O DEV usa `.env.development`, SQLite/cache em `data/development/` e uma biblioteca descartável em `music-dev/`. Não aponte esse ambiente para o SQLite ou `MUSIC_DIR` reais.

Fluxo completo: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). Isolamento dos ambientes: [`docs/development-environments.md`](docs/development-environments.md).

## Testes e qualidade

Gate local normal antes do PR:

```bash
npm run check
```

Esse comando cobre typecheck, testes funcionais e build. O CI obrigatório adiciona os gates definidos em `.github/workflows/ci.yml`, incluindo segurança, backup/restore e E2E promovidos ao workflow.

Validações adicionais continuam proporcionais ao risco:

```bash
npm run test:security
npm run test:policy
npm run test:ops
npm run test:e2e
npm run benchmark:large-library
npm run benchmark:large-library:browser
npm run benchmark:backpressure
npm run smoke:production
```

Política completa: [`docs/testing-and-quality.md`](docs/testing-and-quality.md).

## Produção

Produção usa `.env`, systemd, porta `8787` e a biblioteca/SQLite reais.

Primeiro bootstrap privilegiado:

```bash
npm run service:install
```

Atualização normal depois do merge em `main`:

```bash
npm run prod:status
npm run prod:check
npm run prod:backup
npm run prod:deploy
npm run prod:verify
```

Logs:

```bash
npm run prod:logs
```

A receita canônica está em [`docs/PRODUCTION.md`](docs/PRODUCTION.md). Detalhes de systemd/helper privilegiado em [`docs/production.md`](docs/production.md).

## Backup e restore

Criar backup:

```bash
npm run backup:create
```

Verificar:

```bash
npm run backup:verify -- --artifact PATH
```

Restore é offline:

```bash
sudo systemctl stop home-music
npm run backup:restore -- --artifact PATH --confirm-service-stopped
sudo systemctl start home-music
npm run prod:verify
```

Guia completo: [`docs/backup-restore.md`](docs/backup-restore.md).

## Tailscale

Perfil privado recomendado:

```bash
npm run tailscale:enable
npm run tailscale:status
```

Funnel público, quando intencional:

```bash
npm run tailscale:public:enable
npm run tailscale:public:status
```

Documentação: [`docs/tailscale.md`](docs/tailscale.md), [`docs/public-access.md`](docs/public-access.md) e [`docs/tailscale-hardening.md`](docs/tailscale-hardening.md).

## Segurança operacional

- `.env`, `.env.development`, cookies, tokens e senhas nunca são versionados;
- o backend é a fronteira real de autenticação, autorização e confinement;
- mutações autenticadas preservam `X-Home-Music-Request: 1` quando o contrato exigir;
- paths físicos da biblioteca não são expostos ao frontend nem ao adapter OpenSubsonic;
- superfícies sensíveis bloqueiam traversal, symlink escape e arquivos especiais;
- importação usa staging/scratch antes de promover conteúdo para `MUSIC_DIR`;
- providers e processos externos não recebem shell livre;
- chaves OpenSubsonic são independentes da senha/sessão web e persistidas somente em forma hash;
- ações destrutivas devem ser explícitas e preferir quarentena/restauração quando aplicável;
- sugestões do Assistente continuam sujeitas a revisão, stale protection e às autoridades canônicas de cada domínio.

## Comandos principais

| Comando | Uso |
| --- | --- |
| `npm run dev` | inicia backend + frontend DEV isolados |
| `npm run check` | baseline local de PR e primeiro gate do CI |
| `npm run build` | build dos workspaces |
| `npm test` | testes funcionais |
| `npm run test:e2e` | suíte Playwright completa |
| `npm run test:ops` | contratos shell de systemd/Tailscale |
| `npm run test:security` | regressões negativas sensíveis |
| `npm run test:policy` | políticas de dependência/lifecycle |
| `npm run prod:status` | estado da instalação systemd |
| `npm run prod:check` | preflight de produção |
| `npm run prod:backup` | backup antes de mutação de produção |
| `npm run prod:deploy` | atualização segura via `service:update` |
| `npm run prod:verify` | readiness/verificação funcional |
| `npm run prod:logs` | logs do systemd |
| `npm run ffmpeg:status` | diagnóstico FFmpeg/FFprobe |

## Documentação

Comece por:

- [`docs/README.md`](docs/README.md) — índice e classificação da documentação;
- [`docs/roadmap.md`](docs/roadmap.md) — estado técnico corrente e próximos ciclos;
- [`docs/architecture.md`](docs/architecture.md) — arquitetura vigente;
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — setup e fluxo de engenharia;
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — operação da instalação real;
- [`docs/android-tv.md`](docs/android-tv.md) — Home Music TV, BTV 11, instalação e navegação por controle;
- [`docs/library-assistant.md`](docs/library-assistant.md) — Assistente da Biblioteca;
- [`docs/lyrics.md`](docs/lyrics.md) — resolução de lyrics, LRCLIB e Whisper local;
- [`docs/pwa.md`](docs/pwa.md) e [`docs/offline-downloads.md`](docs/offline-downloads.md) — PWA/offline;
- [`docs/open-subsonic.md`](docs/open-subsonic.md) — compatibilidade OpenSubsonic;
- [`docs/testing-and-quality.md`](docs/testing-and-quality.md) — política de gates.

Agentes de IA e automações de desenvolvimento devem ler [`AGENTS.md`](AGENTS.md) antes de alterar o repositório.
