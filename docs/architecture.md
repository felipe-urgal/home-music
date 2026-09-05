# Arquitetura

Este documento descreve a arquitetura **atual** do Home Music. Documentos `phase-*` preservam decisões e etapas históricas; quando houver diferença, este arquivo e o `README.md` representam o estado operacional corrente.

## Visão geral

O Home Music é um monorepo npm workspaces:

```text
home-music/
├── apps/web        React + TypeScript + Vite
├── apps/server     Fastify + TypeScript + SQLite
├── packages/shared contratos/tipos compartilhados
├── data            SQLite e estado derivado local
├── scripts         operação, CI/smoke, systemd e Tailscale
└── docs             documentação técnica
```

Em produção existe **um processo Fastify**. Ele serve API, frontend compilado, streaming, capas, endpoints administrativos e o adapter OpenSubsonic `/rest/*` pela mesma porta interna.

## Desenvolvimento

```text
Navegador
   ↓
Vite :5173
   ↓ proxy /api
Fastify :8787 em 127.0.0.1
```

O Vite existe apenas para HMR/desenvolvimento.

## Produção

### LAN

```text
Navegador/PWA/cliente OpenSubsonic
   ↓ HTTP :8787
Fastify 0.0.0.0:8787
   ├── React compilado
   ├── autenticação/sessões + API keys de apps
   ├── API /api/* + adapter /rest/*
   ├── scanner/importação/administração
   ├── streaming/capas
   └── SQLite + MUSIC_DIR
```

HTTP LAN é fallback local e não deve ser exposto por port-forwarding.

### Tailscale Serve — recomendado

```text
Cliente no tailnet
   ↓ HTTPS :443 (*.ts.net)
Tailscale Serve
   ↓ HTTP loopback
Fastify 127.0.0.1:8787
```

O backend fica inacessível diretamente pela LAN/tailnet nesse perfil. Cookie `Secure` é habilitado explicitamente depois da validação HTTPS.

### Tailscale Funnel — opcional

Quando o administrador precisa acessar **sem cliente Tailscale** no dispositivo remoto, o projeto possui perfil Funnel opcional.

Funnel publica a URL `*.ts.net` na internet, mas mantém o Fastify em loopback e preserva a autenticação própria do Home Music. É uma exposição consciente da tela de login, não o perfil recomendado por padrão.

Veja `tailscale.md`, `public-access.md` e `tailscale-funnel-troubleshooting.md`.

## Frontend de produção

`npm run build` gera `apps/web/dist`.

O servidor:

- exige `index.html` válido antes de considerar produção pronta;
- serve assets hashados com cache longo/imutável;
- serve shell/HTML com `no-store`;
- mantém `/api/*` e `/rest/*` como APIs, sem fallback SPA;
- rejeita traversal, NUL, arquivos ocultos inseguros e symlink escape na camada estática.

## Identidade e autorização

### Bootstrap

`HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` servem **somente para criar o primeiro administrador quando a tabela `users` está vazia**.

Depois que existe usuário persistido no SQLite, login normal usa as contas e hashes do banco. A recomendação operacional é remover as credenciais de bootstrap do `.env` depois de validar o primeiro administrador.

### Usuários

Papéis atuais:

```text
admin
user
```

A biblioteca física é compartilhada, mas dados pessoais são isolados por usuário, incluindo favoritos, histórico/estatísticas, playlists manuais, estado do player e namespace offline.

### Sessões

Sessões usam token aleatório opaco em cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` quando HTTPS está ativo.

O token resolve para `userId`; role/estado vigente são avaliados pelo servidor. Sessões ficam em memória e são revogadas em restart do processo.

### Política

Rotas são classificadas centralmente como `public`, `authenticated` ou `admin`. Esconder menus no frontend é somente UX.

Mutações autenticadas usam também:

```text
X-Home-Music-Request: 1
```

para a proteção anti-CSRF da aplicação.

### Credenciais para clientes OpenSubsonic

Clientes externos **não** reutilizam cookie nem senha web. O usuário cria em **Minha conta** uma API key dedicada por aplicativo:

- o segredo em claro é mostrado somente na criação;
- o SQLite persiste somente SHA-256 + hint não sensível;
- a chave é vinculada a um `userId` imutável;
- revogar a chave bloqueia `/rest/*` sem revogar a sessão web;
- conta desabilitada ou com troca obrigatória de senha deixa de autenticar pelo adapter;
- ownership de playlists, favoritos e histórico deriva exclusivamente da chave autenticada, nunca de `username` recebido do cliente.

Como o protocolo transporta `apiKey` em query parameter, o logger HTTP registra somente o pathname. A query completa também é sanitizada em caminhos explícitos de erro/backpressure.

## SQLite

O banco padrão é `data/home-music.db`.

Ele mantém, entre outros:

- usuários e hashes de senha;
- hashes/hints das API keys OpenSubsonic;
- índice da biblioteca;
- estado ativo/inativo administrativo de faixas;
- favoritos por usuário;
- histórico/estatísticas por usuário;
- playlists manuais por usuário;
- estado/fila do player por usuário;
- overrides de metadata e capa;
- aliases lógicos de artista/álbum;
- estado necessário a operações administrativas/importações;
- histórico operacional.

O schema usa migrations via `PRAGMA user_version`, WAL e foreign keys. Tabelas auxiliares de features não destrutivas, como `library_metadata_aliases`, são criadas de forma idempotente pelo respectivo store e permanecem cobertas pelo snapshot do SQLite.

A persistência do índice distingue dois caminhos. Com a mesma `MUSIC_DIR`, o scanner entrega um delta explícito de faixas adicionadas, atualizadas e removidas, e somente esse delta é aplicado à tabela `tracks`; um rescan sem mudanças não executa upsert de faixa. `libraryRoot` e `scannedAt` são atualizados na mesma transação `BEGIN IMMEDIATE` do delta. Quando a raiz muda ou o snapshot persistido não pode ser reutilizado, permanece disponível o full sync seguro que reconcilia o snapshot completo. Falha em qualquer etapa faz rollback integral.

A indexação incremental após uma importação promovida usa o mesmo caminho de delta para inserir ou atualizar apenas a faixa correspondente. A fase SQLite registra modo de persistência, duração, quantidade de upserts e remoções para diagnóstico de performance sem expor dados sensíveis.

Tokens de sessão não são persistidos no SQLite.

## Biblioteca e scanner

`MUSIC_DIR` é a fonte física.

O scanner:

1. resolve e valida a raiz;
2. percorre arquivos suportados;
3. reaproveita entradas inalteradas por `size + mtime`;
4. processa arquivos novos/modificados com concorrência limitada;
5. produz snapshot reconciliado e delta explícito `added / updated / removed`;
6. persiste somente o delta quando a raiz permanece a mesma;
7. publica o snapshot em memória somente depois da persistência bem-sucedida.

O scan normal é **mutável/reconciliador**. Se um arquivo indexado desapareceu fisicamente, o scan pode remover seu registro do índice. Subpastas temporariamente inacessíveis e arquivos em quarentena preservam as faixas anteriores e não entram como remoção no delta.

Streaming e operações de filesystem revalidam confinement para impedir path traversal/symlink escape.

## Integridade da biblioteca

A auditoria administrativa de Integridade é separada do scan normal.

```text
Verificar agora
   ↓
auditoria read-only
   ├── scanner-failed
   ├── media-probe-failed
   ├── missing-file
   └── unindexed-file
```

Ela não remove nem altera arquivo/registro. O snapshot da última verificação fica disponível para o cockpit administrativo.

Essa separação é deliberada: diagnóstico não deve executar reconciliação destrutiva implicitamente.

## Administração

A área administrativa é exclusiva de `admin` e usa layout fluido no desktop.

Superfícies atuais:

- cockpit/visão geral;
- Gerenciar músicas;
- Importação;
- Integridade;
- Duplicatas;
- Normalização lógica;
- Usuários;
- Metadados;
- Lixeira/quarentena;
- histórico e manutenção operacional.

As telas redesenhadas preferem listas limpas, inspetores/workspaces contextuais e ações em lote sob demanda, sem mover autorização para o cliente.

**Minha conta** também expõe o autosserviço de API keys OpenSubsonic para criar, listar e revogar somente credenciais do próprio usuário.

## Operações destrutivas

Princípios:

- desativar faixa é reversível e não remove o arquivo;
- remoção da biblioteca passa por lixeira/quarentena;
- restauração é o caminho preferencial;
- exclusão permanente exige confirmação explícita;
- exclusão permanente em lote exige confirmação digitada;
- movimentação de arquivo é confinada a `MUSIC_DIR`, sem overwrite silencioso;
- diagnóstico de Integridade nunca executa remoção automática.

## Overrides e projeção canônica de metadata/capa

Correções administrativas são não destrutivas por padrão:

```text
metadata física
   + override SQLite por faixa
   = metadata efetiva
```

Para artista/álbum, a visão consumida pela biblioteca pode receber mais uma camada lógica:

```text
metadata física
   ↓
override por faixa
   ↓
alias lógico global/reversível
   ↓
metadata canônica publicada
```

Aliases são aprovados manualmente em **Administração → Normalização**. Artistas são globais; álbuns são escopados pelo artista do álbum já canônico. A camada não altera `track.id`, não escreve em `MUSIC_DIR` e é reutilizada por `/api/library`, pelo adapter OpenSubsonic e pela avaliação de smart playlists.

A mesma ideia não destrutiva vale para capa. Scanner/rescan não deve apagar overrides ou aliases válidos.

Escrita opcional de volta ao arquivo original não faz parte do comportamento padrão atual.

Detalhes: `admin-metadata-overrides.md` e `library-metadata-normalization.md`.

## Importação

Todas as origens convergem para o mesmo pipeline:

```text
upload / URL / provider
        ↓
staging ou scratch fora de MUSIC_DIR
        ↓
validação técnica (FFprobe/FFmpeg)
        ↓
preview/ajuste de metadata
        ↓
detecção de duplicatas
        ↓
destino seguro / no-clobber
        ↓
promoção para MUSIC_DIR
        ↓
indexação incremental
```

Providers externos são desacoplados do core. O provider `yt-dlp` é opcional e nunca escreve diretamente em `MUSIC_DIR`. O provider Jamendo segue a mesma fronteira: revalida licença/download no servidor, adquire somente para scratch privado, transfere ao staging comum e deixa validação/duplicatas/promoção/indexação para o pipeline existente.

O pipeline possui cleanup de staging, retry/diagnóstico e suporte a lotes/playlists por provider com isolamento por item. Os testes Jamendo incluem rate limit, resposta malformada, conteúdo removido, redirect inseguro e payload inválido usando fakes locais sem internet pública.

Detalhes: `jamendo.md`.

## Transcoding e ReplayGain

Streaming original é preferido.

FFmpeg entra para:

- Economia/compatibilidade;
- normalização ReplayGain;
- decisões do pipeline de importação.

O cache de transcoding é derivado, limitado e recriável. A chave inclui propriedades relevantes do arquivo/perfil/ganho para evitar colisões.

O backend resolve ReplayGain do índice; não aceita ganho arbitrário enviado pelo cliente. O arquivo original nunca é alterado.

## Adapter OpenSubsonic

OpenSubsonic é uma **camada de protocolo**, não um segundo backend.

```text
cliente OpenSubsonic
      ↓ /rest/* + apiKey
adapter OpenSubsonic
      ├── LibraryService
      ├── TrackMediaInfrastructure
      └── PersonalLibraryService
              ↓
       SQLite + MUSIC_DIR existentes
```

O subset inicial cobre capabilities, biblioteca/artistas/álbuns/faixas, navegação, `search3`, HTTP Range, artwork, lyrics, playlists manuais, favoritos e scrobble. Endpoints fora do subset falham explicitamente em vez de simular sucesso.

IDs de artista/álbum são projeções opacas determinísticas; `track.id` continua sendo o ID da música. Nenhuma resposta expõe `filePath` ou `MUSIC_DIR`.

Streaming usa a mesma infraestrutura nativa de confinement, arquivo regular, Range e transcoding. Estado pessoal usa o `userId` derivado da API key e continua coerente com o frontend.

O CI usa cliente HTTP/fixtures locais para contrato e ownership; Symfonium, Feishin e Tempo/Tempus são somente alvos de validação manual. A issue #264 só deve ser fechada após registrar evidência real de pelo menos dois clientes autenticando, listando a biblioteca e reproduzindo áudio.

Detalhes: `open-subsonic.md`.

## PWA e offline

O cache estático contém apenas shell/assets públicos. Conteúdo autenticado de `/api/*` não é cacheado como parte do app shell.

Áudio offline usa namespace por usuário e separa artefato físico de intenção lógica:

```text
home-music:offline-tracks:v2:<userId>      # manifesto físico
home-music:offline-references:v1:<userId>  # referências lógicas
home-music-offline-audio-v2-<userId>       # bytes no Cache Storage
```

O service worker usa capability **v4** e associa cada client/aba ao usuário autenticado antes de servir `/offline-audio/<trackId>`. A v4 também anuncia `backgroundFetch` quando a API existe no registro ativo.

O scheduler global continua limitado a 3 downloads simultâneos e usa `userId + trackId` como chave. Download individual, lote desktop, playlist e pasta reutilizam esse mesmo pipeline; uma faixa compartilhada por várias referências possui **um único artefato físico**.

```text
artefato físico trackId
        ↑
        ├── referência individual
        ├── playlist A
        ├── playlist B
        └── pasta X
```

Playlists e pastas persistem snapshots lógicos. Mudanças posteriores ficam visíveis como conteúdo desatualizado até atualização explícita. Remover uma coleção ou referência individual só coleta os bytes quando nenhuma outra referência do mesmo usuário ainda depende da faixa.

Downloads `tracks:v2` existentes antes da camada de referências são migrados conservadoramente como intenção individual para impedir cleanup destrutivo. Jobs em voo revalidam a existência de referências antes de publicar o manifesto físico, fechando a corrida com remoção concorrente.

Em navegadores com Background Fetch, a transferência de uma faixa pode ser delegada ao navegador. No `backgroundfetchsuccess`, o worker valida a registration `userId + trackId`, exige uma única resposta completa same-origin para a rota de streaming e grava os bytes somente no cache do proprietário. Ele **não publica o manifesto físico**; quando a página volta a executar, o fluxo normal confirma o cache e revalida a referência lógica antes de marcar a faixa como disponível.

Navegadores sem a API continuam no `fetch()` foreground. Safari/iPhone/iPad permanecem nesse fallback enquanto não houver suporte. A matriz de hardware da #81 foi concluída e a issue encerrada; suporte de API continua não substituindo os limites reais de cada plataforma, e fechar/recarregar a aba ainda não é tratado como garantia de retomada/publicação.

Detalhes: `offline-downloads.md` e `pwa.md`.

## Backup e restore

Backup usa snapshot consistente do SQLite e manifesto verificado. A biblioteca física em `MUSIC_DIR` **não** faz parte do artefato e precisa de backup próprio.

Restore é offline, valida o artefato antes da troca, cria snapshot de rollback e tenta restaurar o estado anterior em falha pós-troca.

Detalhes em `backup-restore.md`.

## Liveness e readiness

Endpoints:

```text
GET /health      público, liveness mínimo
GET /ready       público, readiness mínimo
GET /api/health  autenticado, diagnóstico detalhado
```

`/ready` exige frontend preparado em produção, autenticação configurada e biblioteca carregável/pronta.

## Ciclo de vida e systemd

O processo registra handlers de shutdown e fecha Fastify/SQLite de forma coordenada.

`scripts/install-systemd.sh`:

- restringe permissões de `.env`, `data/` e SQLite;
- para o serviço antes de `npm ci`/build no modo update;
- valida artefatos e unit;
- executa `systemctl daemon-reload`;
- habilita/reinicia a unidade;
- confirma que o serviço terminou ativo;
- aplica hardening systemd.

Depois de merge:

```bash
git switch main
git pull --ff-only origin main
npm run service:update
```

## Qualidade e gates de CI

O workflow obrigatório mantém um único job de validação e executa, em ordem compatível com custo/risco:

- instalação reproduzível e auditoria de dependências;
- typecheck;
- `npm run test:security` para regressões negativas transversais de Administração/Importação;
- suíte funcional `npm test`;
- `npm run benchmark:large-library` para regressões graves de performance com dataset sintético;
- cenário browser-real de biblioteca grande em Chromium;
- smokes de backup/restore e validações operacionais de scripts, systemd e Tailscale;
- build de produção;
- Playwright crítico em mobile/tablet/desktop;
- smoke real de produção.

A regressão Playwright completa continua disponível sob demanda conforme risco. Os benchmarks não substituem testes funcionais e seus limites não são SLA de produto. Mudanças no head depois de um run verde invalidam esse run como gate final, conforme `AGENTS.md`.

## Segurança resumida

- backend é a fronteira de autorização;
- produção remota prefere loopback + Tailscale Serve;
- Funnel é opcional e conscientemente público;
- cookies `HttpOnly`/`SameSite=Strict` e `Secure` em HTTPS;
- login possui proteção por IP/identidade e limites globais de verificação de senha;
- mutações protegidas por sessão + header da aplicação;
- API keys OpenSubsonic são separadas da sessão/senha, revogáveis e persistidas somente em forma hash;
- query string não entra nos logs HTTP, incluindo caminhos de erro;
- paths físicos não são aceitos como autoridade do cliente nem expostos em `/rest/*`;
- streaming/filesystem revalidam confinement e arquivos regulares;
- importação URL aplica proteção SSRF;
- providers externos usam isolamento/timeout;
- Jamendo reaplica licença/download no backend antes da aquisição física;
- operações destrutivas são explícitas;
- normalização lógica não escreve em arquivos e exige admin;
- Integrity é read-only;
- dependências usam lockfile + `npm ci`;
- CI mantém gates explícitos de segurança, funcionalidade, performance, build, E2E crítico e produção.