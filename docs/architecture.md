# Arquitetura

Este documento descreve a arquitetura **vigente** do Home Music. Detalhes de feature, matrizes de compatibilidade e runbooks ficam nas docs de domínio para evitar duplicação.

Se houver conflito, código, testes, `package.json`, workflows e contratos executáveis têm precedência.

## Visão geral

O Home Music é um monorepo npm workspaces:

```text
home-music/
├── apps/web        React + TypeScript + Vite
├── apps/server     Fastify + TypeScript + SQLite
├── packages/shared contratos/tipos compartilhados
├── e2e             Playwright
├── scripts         operação, smokes, systemd e Tailscale
├── docs            documentação técnica
└── .github         CI e automações
```

Em produção existe **um processo Fastify** servindo frontend compilado, `/api/*`, `/rest/*`, streaming/capas e integrações do backend pela mesma porta interna.

## Topologia

### Desenvolvimento

```text
Browser
   ↓
Vite :5173
   ↓ proxy /api
Fastify :8788
```

DEV usa `.env.development`, dados em `data/development/` e biblioteca descartável. Não deve compartilhar SQLite, `MUSIC_DIR` nem credenciais com produção.

### Produção

```text
Browser / PWA / cliente OpenSubsonic
            ↓
     Tailscale/LAN
            ↓
Fastify :8787
  ├── frontend compilado
  ├── /api/*
  ├── /rest/*
  ├── streaming/capas
  ├── SQLite
  └── MUSIC_DIR
```

Tailscale Serve + HTTPS é o perfil remoto recomendado. Funnel é exposição pública explícita/opcional.

## Frontend

O frontend é React + TypeScript + Vite.

Princípios:

- Vite é ferramenta de desenvolvimento/build; produção é servida pelo Fastify;
- autorização real nunca depende de menu/rota escondida no React;
- componentes consomem contratos HTTP/estado de domínio, não filesystem ou SQLite;
- player e biblioteca compartilham identidade estável de faixa;
- PWA/offline preserva isolamento por usuário;
- `useAudioPlayer` permanece autoridade de playback por modo;
- Assistente/Administração são projeções das capacidades do backend, não autoridades paralelas.

Composição: [`app-composition.md`](app-composition.md).

## Backend

Fastify + TypeScript concentra as fronteiras de confiança:

- autenticação e autorização;
- validação de input;
- ownership por usuário;
- SQLite e migrations;
- confinement de filesystem;
- scanner/projeção da biblioteca;
- streaming/transcoding;
- importação e Administração;
- Assistente da Biblioteca e gateways de providers;
- jobs locais/opcionais como fingerprint e Whisper;
- adapter OpenSubsonic;
- lifecycle de recursos/processos.

O entrypoint deve permanecer principalmente composição/wiring. Serviços encapsulam comportamento e recursos externos.

## Identidade e ownership

A biblioteca física é compartilhada, mas dados pessoais são isolados por `userId`.

Papéis atuais:

```text
admin
user
```

O backend é a fronteira real de autorização. Sessão web e credenciais OpenSubsonic são mecanismos separados.

Ownership pessoal cobre favoritos, histórico/estatísticas, playlists, estado do player, downloads offline e portabilidade pessoal.

Fonte: [`multi-user-auth.md`](multi-user-auth.md).

## SQLite

SQLite é o estado persistente principal. Ele contém, entre outros:

- usuários, sessões/credenciais derivadas e ownership;
- índice da biblioteca;
- favoritos, histórico, playlists e estado do player;
- overrides/aliases de metadata e capa;
- lyrics gerenciadas e histórico de rollback;
- runs, sugestões, cache/proveniência e política do Assistente;
- estado de importações e histórico operacional.

Migrations usam `PRAGMA user_version`. Produção deve usar backup/restore suportado em vez de editar schema manualmente.

## Biblioteca e filesystem

`MUSIC_DIR` é a fonte física da biblioteca.

Invariantes:

- path vindo do cliente não é autoridade;
- operações revalidam confinement no servidor;
- traversal, symlink escape e arquivos especiais são rejeitados nas superfícies sensíveis;
- ações destrutivas são explícitas;
- quarentena/restauração é preferida quando aplicável;
- movimentações não sobrescrevem arquivos silenciosamente.

Scanner e Integridade são fluxos diferentes: Integridade é diagnóstico read-only, não corretor implícito.

## Projeção de metadata

A faixa publicada é derivada por camadas não destrutivas:

```text
metadata física/indexada
       ↓
override por faixa
       ↓
alias/normalização quando aplicável
       ↓
metadata efetiva
```

Scanner/rescan não deve apagar decisões persistidas válidas.

Docs: [`admin-metadata-overrides.md`](admin-metadata-overrides.md), [`admin-cover-overrides.md`](admin-cover-overrides.md) e [`library-metadata-normalization.md`](library-metadata-normalization.md).

## Assistente da Biblioteca

`LibraryAssistantService` orquestra análise e sugestões sobre a biblioteca efetiva. Ele não é dono de `tracks`, capa ou lyrics publicadas.

```text
biblioteca efetiva
      ↓
Assistente
      ├── MusicBrainz
      ├── Cover Art Archive
      ├── LRCLIB
      ├── Chromaprint/AcoustID opcional
      └── Whisper local opcional
      ↓
evidências + sugestões
      ↓
review / política opt-in
      ↓
autoridades existentes
```

Providers passam por gateways com cache/rate limit/timeout/cancelamento. Processos locais usam executável + argumentos e limites explícitos. Nenhum provider escreve diretamente em `MUSIC_DIR`.

Fonte: [`library-assistant.md`](library-assistant.md).

## Lyrics

A resolução efetiva é única:

```text
override gerenciado aprovado
        ↓
sidecar .lrc/.txt
        ↓
nenhuma letra
```

Player, offline e OpenSubsonic consomem a mesma cadeia. LRCLIB e Whisper são fontes de candidatos, não caminhos de playback.

Fonte: [`lyrics.md`](lyrics.md).

## Artwork

Capa efetiva mantém precedência de override/fonte física. Ausência de capa usa identidade visual derivada e versionada; a mesma política alimenta biblioteca, player e projeção estática para Media Session.

Fonte: [`artwork-fallback.md`](artwork-fallback.md).

## Importação

Origens convergem para o mesmo modelo seguro:

```text
upload / URL / provider
        ↓
staging ou scratch fora de MUSIC_DIR
        ↓
validação
        ↓
preview/duplicatas/destino seguro
        ↓
promoção para MUSIC_DIR
        ↓
indexação
```

Conteúdo externo não escreve diretamente na biblioteca final.

## Streaming, FFmpeg e trabalho pesado

Streaming original é preferido quando compatível. FFmpeg/FFprobe entram para validação, transcoding e preparação de mídia para jobs locais quando necessário.

Cache de transcode é derivado e recriável. Trabalho pesado reutiliza fila/backpressure/observabilidade compartilhados em vez de criar executores independentes sem coordenação.

## OpenSubsonic

OpenSubsonic é uma camada de protocolo sobre os serviços existentes, não um segundo catálogo.

Autenticação, biblioteca, streaming, estado pessoal e lyrics reutilizam as autoridades internas correspondentes.

Fonte: [`open-subsonic.md`](open-subsonic.md).

## PWA e offline

O app shell público pode ser cacheado; dados autenticados não viram shell compartilhável. Downloads usam namespace lógico por usuário e o service worker serve apenas o cache associado ao contexto correto.

Cold start offline usa manifesto local como índice rápido e reconcilia os bytes depois da montagem. Media Session continua uma projeção do player, não outro controller.

Fontes: [`pwa.md`](pwa.md) e [`offline-downloads.md`](offline-downloads.md).

## Administração

Administração é uma projeção de capacidades `admin`. Inclui biblioteca, metadata, Assistente, importação, integridade, usuários, quarentena e histórico operacional.

Minha conta é autosserviço do usuário autenticado: senha, sessões, credenciais OpenSubsonic, portabilidade pessoal e entrada manual no modo offline quando disponível.

Fonte: [`administration-ui.md`](administration-ui.md).

## Produção

A aplicação roda sob systemd. Operações privilegiadas passam pelos scripts/helper suportados, não por execução genérica de comandos arbitrários.

Fluxo normal depois do merge:

```text
prod:status
→ prod:check
→ prod:backup
→ prod:deploy
→ prod:verify
```

Runbook: [`PRODUCTION.md`](PRODUCTION.md).

## Qualidade

Baseline local:

```bash
npm run check
```

Gates adicionais dependem do risco e o workflow `.github/workflows/ci.yml` é a fonte executável do CI obrigatório.

Política: [`testing-and-quality.md`](testing-and-quality.md).

## Documentação arquitetural

- detalhes de feature ficam na doc de domínio;
- status transitório fica no roadmap/issues/PRs;
- planos encerrados/snapshots substituídos vão para `docs/history/`;
- mudança de topologia, ownership, fronteira de segurança ou persistência atualiza este documento no mesmo PR.
