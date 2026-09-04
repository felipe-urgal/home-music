# Home Music

Servidor pessoal de música para transformar uma pasta local do Ubuntu em uma biblioteca de streaming acessível pelo navegador, celular ou PWA.

O Home Music usa **React + TypeScript + Vite** no frontend e **Fastify + TypeScript + SQLite** no backend. Em produção, um único processo Fastify serve API, frontend compilado, capas e streaming de áudio.

> O Home Music é self-hosted. Não exponha a porta `8787` diretamente à internet. Para acesso remoto, prefira Tailscale Serve + HTTPS; Funnel é uma opção pública explícita quando necessária.

## Principais recursos

- biblioteca local com scanner incremental, busca, pastas, artistas, álbuns, favoritos e playlists;
- player com fila, shuffle/repeat, Media Session, streaming HTTP Range e ReplayGain;
- PWA e downloads offline isolados por usuário;
- múltiplas contas com papéis `admin`/`user`, sessões e troca de senha;
- Administração para biblioteca, metadata, integridade, lixeira/quarentena, importação e usuários;
- importação por upload, URL e providers externos com staging e validação;
- FFmpeg/FFprobe para compatibilidade, transcode e validação técnica;
- SQLite versionado, backup/restore e operação systemd;
- acesso remoto via Tailscale Serve e Funnel opcional.

## Arquitetura

```text
Browser / PWA
      |
      v
React / Vite (DEV)
      |
      v
Fastify
  |   |   |
  |   |   +--> streaming / FFmpeg / importação
  |   +------> SQLite
  +----------> MUSIC_DIR
```

Em produção, o frontend compilado é servido pelo próprio Fastify. Mais detalhes: [`docs/architecture.md`](docs/architecture.md).

## Requisitos

- Ubuntu/Linux para o fluxo operacional suportado;
- Node.js 22 ou superior;
- npm;
- uma pasta local para a biblioteca de áudio;
- FFmpeg/FFprobe recomendados;
- Tailscale recomendado para acesso remoto;
- `yt-dlp` somente para os providers que dependem dele.

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

Gate normal antes do PR:

```bash
npm run check
```

Esse comando executa:

```text
typecheck
-> testes funcionais
-> build
```

O CI usa o mesmo `npm run check`. Validações adicionais são direcionadas pelo risco:

```bash
npm run test:security
npm run test:policy
npm run test:ops
npm run test:e2e
npm run benchmark:large-library
npm run benchmark:large-library:browser
npm run benchmark:backpressure
npm run smoke:production
npm run smoke:backup-restore
```

Para instalar o navegador E2E:

```bash
npm run test:e2e:install
```

Coverage/benchmarks/E2E/smokes não devem virar custo fixo de todo PR apenas por existirem. Política completa: [`docs/testing-and-quality.md`](docs/testing-and-quality.md).

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

`prod:backup` é obrigatório antes de migration quando a política declarada exigir e é recomendado sempre que houver risco de schema/dados.

Logs:

```bash
npm run prod:logs
```

A receita canônica está em [`docs/PRODUCTION.md`](docs/PRODUCTION.md). Detalhes de systemd/helper privilegiado em [`docs/production.md`](docs/production.md) e do contrato consumido pelo Dev Dashboard em [`docs/production-contract.md`](docs/production-contract.md).

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

Hardening:

```bash
npm run tailscale:hardening:status
```

Documentação: [`docs/tailscale.md`](docs/tailscale.md), [`docs/public-access.md`](docs/public-access.md) e [`docs/tailscale-hardening.md`](docs/tailscale-hardening.md).

## Segurança operacional

- `.env`, `.env.development`, cookies, tokens e senhas nunca são versionados;
- o backend é a fronteira de autorização e confinement;
- mutações autenticadas usam a proteção `X-Home-Music-Request: 1`;
- paths físicos da biblioteca não são expostos ao frontend;
- superfícies sensíveis bloqueiam traversal, symlink escape e arquivos especiais;
- importação usa staging/scratch antes de promover conteúdo para `MUSIC_DIR`;
- providers/processos externos não recebem shell livre;
- ações destrutivas devem ser explícitas e preferir quarentena/restauração quando aplicável;
- produção usa helper privilegiado com catálogo fechado em vez de `systemctl` arbitrário via dashboard.

## Comandos principais

| Comando | Uso |
| --- | --- |
| `npm run dev` | inicia backend + frontend DEV isolados |
| `npm run check` | gate normal de PR/CI |
| `npm run build` | build dos workspaces |
| `npm test` | testes funcionais |
| `npm run test:e2e` | suíte Playwright completa |
| `npm run test:ops` | contratos shell de systemd/Tailscale |
| `npm run test:security` | regressões negativas sensíveis |
| `npm run test:policy` | políticas de dependência/lifecycle |
| `npm run prod:status` | estado da instalação systemd |
| `npm run prod:check` | preflight de produção (`check` + smoke) |
| `npm run prod:backup` | backup antes da mutação de produção |
| `npm run prod:deploy` | atualização segura via `service:update` |
| `npm run prod:verify` | readiness/verificação funcional |
| `npm run prod:logs` | logs do systemd |
| `npm run ffmpeg:status` | diagnóstico FFmpeg/FFprobe |

## Documentação

Comece por:

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — setup e fluxo de engenharia;
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — operação da instalação real;
- [`docs/README.md`](docs/README.md) — índice detalhado e estado vivo da documentação;
- [`docs/architecture.md`](docs/architecture.md) — arquitetura;
- [`docs/testing-and-quality.md`](docs/testing-and-quality.md) — política de gates;
- [`docs/backup-restore.md`](docs/backup-restore.md) — dados/recovery;
- [`docs/roadmap.md`](docs/roadmap.md) — estado técnico corrente.

Agentes de IA e automações de desenvolvimento devem ler [`AGENTS.md`](AGENTS.md) antes de alterar o repositório.
