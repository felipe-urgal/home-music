# Ambientes de desenvolvimento e produção

Este documento detalha o isolamento de ambientes. Para a receita diária de desenvolvimento, comece por [`DEVELOPMENT.md`](DEVELOPMENT.md).

O Home Music separa a configuração persistente de desenvolvimento da configuração usada pelo serviço de produção.

## Arquivos

```text
.env.development   # desenvolvimento; não versionado
.env               # produção/systemd; não versionado
```

O backend escolhe o arquivo pelo `NODE_ENV`:

- `NODE_ENV=development` (ou qualquer valor diferente de `production`) usa `.env.development`;
- `NODE_ENV=production` usa `.env`.

O comando raiz `npm run dev` define `NODE_ENV=development`. `npm start` e o unit systemd usam `NODE_ENV=production`.

## Preparar desenvolvimento

```bash
npm ci
cp .env.development.example .env.development
mkdir -p music-dev data/development
```

O exemplo usa paths relativos ao workspace do backend.

Antes do primeiro start, configure uma senha temporária DEV com pelo menos 12 caracteres:

```env
HOME_MUSIC_USER=home-music-dev
HOME_MUSIC_PASSWORD="uma-senha-exclusiva-para-dev"
```

O restante do contrato já vem separado:

```env
MUSIC_DIR="../../music-dev"
HOME_MUSIC_DATABASE_PATH="../../data/development/home-music.db"
HOME_MUSIC_IMPORT_STAGING_DIR="../../data/development/import-staging"
HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR="../../data/development/provider-scratch"
HOME_MUSIC_COOKIE_SECURE=false
PORT=8788
HOST=127.0.0.1
VITE_PROXY_TARGET=http://127.0.0.1:8788
```

Use somente músicas descartáveis/de teste em `music-dev/`. Não aponte desenvolvimento para a biblioteca física de produção.

Depois:

```bash
npm run dev
```

Endereços padrão:

```text
Web: http://localhost:5173
API: http://127.0.0.1:8788
```

Na LAN, o Vite continua acessível por `http://IP_DO_PC:5173`.

Antes do PR, o gate normal é:

```bash
npm run check
```

Checks adicionais entram conforme o risco; veja [`testing-and-quality.md`](testing-and-quality.md).

## Produção

A produção continua usando `.env`, systemd e o contrato existente:

```text
Fastify/systemd: 8787
SQLite: data/home-music.db por padrão
MUSIC_DIR: biblioteca real
```

Operação diária e sequência canônica: [`PRODUCTION.md`](PRODUCTION.md).

Não copie valores de `.env` para `.env.development` sem revisar os paths. Banco, staging, scratch e `MUSIC_DIR` devem permanecer isolados.

## Primeiro administrador DEV

`HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` em `.env.development` servem somente para criar o primeiro administrador do banco DEV. Depois de confirmar o primeiro login, remova as duas variáveis e reinicie `npm run dev`. A conta continua persistida no SQLite de desenvolvimento e não interfere na produção.
