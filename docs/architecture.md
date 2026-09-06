# Arquitetura

Este documento descreve a arquitetura **vigente** do Home Music. Ele registra topologia, fronteiras e invariantes duráveis; detalhes de feature, matrizes de compatibilidade e runbooks ficam nas docs de domínio para evitar duplicação e divergência.

Se houver conflito, código, testes, `package.json`, workflows e contratos executáveis têm precedência.

## Visão geral

O Home Music é um monorepo npm workspaces:

```text
home-music/
├── apps/web        React + TypeScript + Vite
├── apps/server     Fastify + TypeScript + SQLite
├── packages/shared contratos/tipos compartilhados
├── e2e             Playwright e fixtures browser-real
├── scripts         operação, CI/smokes, systemd e Tailscale
├── docs            documentação técnica
└── .github         CI e automações
```

Em produção existe **um processo Fastify**. Ele serve frontend compilado, `/api/*`, streaming/capas e o adapter OpenSubsonic `/rest/*` pela mesma porta interna.

## Topologia de execução

### Desenvolvimento

```text
Browser
   ↓
Vite :5173
   ↓ proxy /api
Fastify :8788 em 127.0.0.1
```

O ambiente DEV usa `.env.development`, SQLite/cache em `data/development/` e biblioteca descartável em `music-dev/`. Ele não deve compartilhar SQLite, `MUSIC_DIR` nem credenciais com produção.

Fonte canônica: [`DEVELOPMENT.md`](DEVELOPMENT.md) e [`development-environments.md`](development-environments.md).

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

Tailscale Serve + HTTPS é o perfil remoto recomendado. Funnel é exposição pública explícita e opcional. A porta interna `8787` não deve ser publicada diretamente na internet.

Operação: [`PRODUCTION.md`](PRODUCTION.md), [`production.md`](production.md), [`tailscale.md`](tailscale.md) e [`public-access.md`](public-access.md).

## Frontend

O frontend é React + TypeScript + Vite.

Princípios estruturais:

- Vite é ferramenta de desenvolvimento/build; produção é servida pelo Fastify;
- autorização real nunca depende de menu/rota escondida no React;
- componentes consomem contratos HTTP/estado do domínio em vez de acessar filesystem ou SQLite;
- superfícies densas de Administração preferem lista + inspetor/workspace;
- player e biblioteca compartilham identidade estável de faixa (`track.id`);
- PWA/offline mantém estado isolado por usuário.

Composição: [`app-composition.md`](app-composition.md).

Responsabilidades de tela: [`library-screen-responsibilities.md`](library-screen-responsibilities.md) e [`player-screen-responsibilities.md`](player-screen-responsibilities.md).

## Backend

O backend é Fastify + TypeScript e concentra as fronteiras de confiança:

- autenticação e autorização;
- validação de input;
- ownership por usuário;
- acesso ao SQLite;
- confinement de filesystem;
- scanner e projeção da biblioteca;
- streaming e transcoding;
- importação e operações administrativas;
- adapter OpenSubsonic;
- lifecycle de recursos de processo.

O entrypoint deve permanecer principalmente como composição/wiring. Serviços e infraestrutura encapsulam comportamento de domínio e recursos externos.

Composição: [`server-composition.md`](server-composition.md).

## Identidade, autorização e ownership

A biblioteca física é compartilhada, mas dados pessoais são isolados por `userId`.

Papéis atuais:

```text
admin
user
```

O backend classifica acesso como `public`, `authenticated` ou `admin`. Esconder uma superfície no frontend é somente UX.

Mutações autenticadas usam também:

```text
X-Home-Music-Request: 1
```

Sessões web usam token opaco; credenciais OpenSubsonic são API keys separadas. A senha web não é usada como credencial do protocolo OpenSubsonic.

Ownership pessoal cobre, entre outros:

- favoritos;
- histórico/estatísticas;
- playlists manuais;
- estado/fila do player;
- downloads offline;
- exportação/importação de dados pessoais.

Fonte canônica: [`multi-user-auth.md`](multi-user-auth.md).

Portabilidade: [`personal-data-portability.md`](personal-data-portability.md).

## SQLite

O SQLite é o estado persistente principal da aplicação.

Ele contém, entre outros:

- usuários e hashes de senha;
- hashes/hints das API keys OpenSubsonic;
- índice da biblioteca;
- estado administrativo das faixas;
- dados pessoais com ownership;
- overrides/aliases de metadata e capa;
- estado de importações/operações administrativas;
- histórico operacional.

Migrations usam `PRAGMA user_version`; produção deve usar o fluxo de backup/restore suportado em vez de editar versão/schema manualmente.

O índice da biblioteca privilegia atualização incremental quando a raiz pode ser reutilizada e mantém caminho de reconciliação completa quando necessário. Persistência e publicação do snapshot devem preservar atomicidade: falha de SQLite não pode publicar em memória um estado que não foi persistido.

Backup/restore: [`backup-restore.md`](backup-restore.md).

## Biblioteca e filesystem

`MUSIC_DIR` é a fonte física da biblioteca.

Invariantes:

- paths vindos do cliente não são autoridade;
- operações revalidam confinement no servidor;
- traversal, NUL, symlink escape e arquivos especiais são rejeitados nas superfícies sensíveis;
- ações destrutivas devem ser explícitas;
- quarentena/restauração é preferida a exclusão imediata quando aplicável;
- movimentações não sobrescrevem arquivos silenciosamente.

O scanner reconcilia o índice com a biblioteca física; a auditoria de Integridade é uma superfície read-only separada e não deve executar correções destrutivas implicitamente.

Entrega HTTP: [`library-http-delivery.md`](library-http-delivery.md).

## Metadata e projeção da biblioteca

A apresentação da faixa é derivada por camadas não destrutivas:

```text
metadata física/indexada
       ↓
override por faixa
       ↓
alias lógico quando aplicável
       ↓
metadata efetiva publicada
```

Overrides não devem depender de reescrever o arquivo físico. Scanner/rescan não deve apagar correções persistidas válidas.

Documentos:

- [`admin-metadata-overrides.md`](admin-metadata-overrides.md);
- [`admin-cover-overrides.md`](admin-cover-overrides.md);
- [`library-metadata-normalization.md`](library-metadata-normalization.md).

## Importação

Origens diferentes convergem para o mesmo modelo de segurança:

```text
upload / URL / provider
        ↓
staging ou scratch fora de MUSIC_DIR
        ↓
validação técnica
        ↓
preview/metadata
        ↓
duplicatas
        ↓
destino seguro / no-clobber
        ↓
promoção para MUSIC_DIR
        ↓
indexação
```

Princípios:

- conteúdo externo não escreve diretamente na biblioteca final;
- URL/processo externo é validado no backend;
- staging/scratch é confinando e limpável;
- falha parcial não deve promover artefato inválido;
- provider externo não recebe shell livre;
- regras de licença/download que exigem fail-closed permanecem no servidor.

Docs de importação e providers estão indexadas em [`README.md`](README.md).

## Streaming, FFmpeg e cache derivado

Streaming original é preferido quando compatível. FFmpeg/FFprobe entram para validação técnica, transcoding e compatibilidade.

O cache de transcode é derivado e recriável. Ele não substitui o arquivo original nem deve ser tratado como dado primário.

O backend decide parâmetros e ganho aplicáveis; clientes não podem transformar parâmetros de mídia em acesso arbitrário a processo/filesystem.

Detalhes: [`ffmpeg.md`](ffmpeg.md) e [`admin-transcode-cache.md`](admin-transcode-cache.md).

## OpenSubsonic

OpenSubsonic é uma **camada de protocolo sobre o backend existente**, não um segundo catálogo.

```text
cliente OpenSubsonic
      ↓ /rest/*
adapter
      ├── biblioteca existente
      ├── streaming existente
      └── dados pessoais existentes
              ↓
       SQLite + MUSIC_DIR
```

Invariantes:

- autenticação usa credencial de app vinculada ao usuário;
- ownership deriva da credencial autenticada;
- IDs/projeções de protocolo não expõem path físico;
- streaming reutiliza as mesmas fronteiras de confinement/Range/transcode;
- endpoints fora do subset suportado falham explicitamente;
- compatibilidade real de clientes é documentada na matriz própria, não nesta arquitetura nem no status de uma issue histórica.

Fonte canônica: [`open-subsonic.md`](open-subsonic.md).

## PWA e offline

O app shell público pode usar cache estático; respostas autenticadas de `/api/*` não são tratadas como shell compartilhável.

Downloads offline têm namespace por usuário e o service worker deve saber qual identidade está associada ao client antes de servir áudio privado.

Mudança de usuário, logout, remoção de conteúdo e evolução do formato do cache devem preservar isolamento e evitar reutilização silenciosa de bytes pertencentes a outro contexto.

Fonte canônica: [`pwa.md`](pwa.md) e [`offline-downloads.md`](offline-downloads.md).

## Administração

Administração é uma projeção de capacidades do backend para `admin`; ela não cria uma fronteira de autorização paralela no frontend.

Superfícies incluem biblioteca, importação, integridade, metadata, usuários, quarentena e histórico operacional. **Minha conta** é autosserviço do usuário autenticado e inclui senha/sessões, credenciais OpenSubsonic e portabilidade pessoal conforme as capacidades atuais.

Composição de UX: [`administration-ui.md`](administration-ui.md).

## Produção e privilégios

A aplicação roda sob systemd. Operações privilegiadas devem passar pelo fluxo suportado e por helper de catálogo fechado, não por execução genérica de `systemctl` vinda do produto.

Fluxo normal após merge:

```text
prod:status
-> prod:check
-> prod:backup
-> prod:deploy
-> prod:verify
```

A necessidade de backup depende do risco/política, mas migrations e dados nunca devem ser tratados como rollback trivial de código.

Runbook: [`PRODUCTION.md`](PRODUCTION.md).

## Qualidade e CI

O baseline local de engenharia é:

```bash
npm run check
```

Ele cobre typecheck, testes funcionais e build.

O **workflow** `.github/workflows/ci.yml` é a fonte executável do gate obrigatório. Atualmente o CI acrescenta ao baseline:

- `npm run test:security`;
- `npm run smoke:backup-restore`;
- instalação do Chromium do Playwright;
- E2E focado `e2e/personal-data-import.spec.ts` com um worker.

Outras suítes, benchmarks e smokes continuam direcionados pelo risco da mudança, salvo quando forem explicitamente promovidos ao workflow obrigatório.

Política: [`testing-and-quality.md`](testing-and-quality.md).

## Documentação arquitetural

Para evitar que esta doc volte a acumular status temporário:

- requisitos detalhados de feature ficam na doc de domínio;
- status de execução fica em issues/PRs/roadmap;
- planos futuros usam `*-plan.md` ou ADR/issue explícita;
- milestones encerrados e snapshots substituídos ficam em [`history/`](history/);
- mudanças de topologia, ownership, fronteira de segurança ou persistência atualizam este arquivo no mesmo PR.

O snapshot detalhado anterior a esta consolidação foi preservado em [`history/architecture-before-2026-09-doc-audit.md`](history/architecture-before-2026-09-doc-audit.md) apenas para consulta histórica.
