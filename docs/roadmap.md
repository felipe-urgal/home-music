# Roadmap

Este documento é a visão técnica de alto nível do Home Music. A issue [#123](https://github.com/felipe-urgal/home-music/issues/123) preserva o índice executivo do ciclo de backlog concluído em 2026-09-02. A Fase 12 foi encerrada pela [#239](https://github.com/felipe-urgal/home-music/issues/239), a Fase 13 pela [#266](https://github.com/felipe-urgal/home-music/issues/266) e o ciclo técnico atual está centralizado na [#295](https://github.com/felipe-urgal/home-music/issues/295).

> Estado revisado em 2026-09-05. A Fase 13 está concluída. Na Fase 14, a Onda 1 também foi concluída: #291, #292 e #294 estão integradas à `main` pelos PRs #297, #298 e #299. A #293 é a única pendência técnica do ciclo; sua dependência da #292 já foi satisfeita e a implementação está desbloqueada, porém pausada até a próxima retomada. A #295 permanece aberta como índice executivo da fase.

## Fases 1–2 — Base do produto e biblioteca pessoal

Concluídas.

- [x] scanner recursivo e incremental de músicas;
- [x] API da biblioteca e streaming HTTP Range;
- [x] player mobile, fila contextual e busca;
- [x] PWA básica;
- [x] SQLite;
- [x] favoritos, histórico, estatísticas e playlists persistentes;
- [x] navegação por pastas/subpastas;
- [x] re-scan manual e automático opcional;
- [x] ordenação e filtros avançados.

## Fase 3 — Experiência mobile e offline

Concluída, incluindo a validação explícita em hardware real.

- [x] shuffle e repeat `off / all / one`;
- [x] fila reordenável;
- [x] estado do player persistente e retomada quando permitida pelo navegador;
- [x] Media Session e controles de sistema;
- [x] continuidade da reprodução em background dentro dos limites do navegador;
- [x] autenticação própria responsiva;
- [x] layout sem overflow horizontal;
- [x] download offline individual e em lote com scheduler global de até 3 operações;
- [x] isolamento de cache/manifesto offline por usuário;
- [x] [#81](https://github.com/felipe-urgal/home-music/issues/81) — validação de downloads em background/tela bloqueada concluída em Android e iPhone/iPad reais;
- [x] [#174](https://github.com/felipe-urgal/home-music/issues/174) — playlists e pastas completas offline com um único artefato físico por faixa e múltiplas referências lógicas — entregue pelo PR #218.

A #174 reutiliza o scheduler/cache atual, adiciona manifesto versionado de referências por usuário, migração conservadora dos downloads antigos como intenção individual, sincronização explícita de snapshots e garbage-collection somente quando nenhuma referência depende da faixa. Detalhes: [offline-downloads.md](offline-downloads.md) e [pwa.md](pwa.md).

Em 2026-09-02, o PR #223 adicionou à #81 uma implementação progressiva baseada em Background Fetch: quando o service worker capability v4 e o navegador anunciam suporte, a transferência longa pode ser delegada ao navegador; caso contrário, o fluxo foreground existente permanece como fallback. O manifesto físico continua sendo publicado pela aplicação somente após revalidar a referência lógica. A matriz física Android + iPhone/iPad foi concluída posteriormente e a #81 foi encerrada; as garantias continuam específicas por capacidade e plataforma, sem transformar suporte de API em promessa universal.

## Fases 4–6 — Produção, acesso remoto e extras

Concluídas para o escopo atual.

- [x] build React servido pelo Fastify em produção;
- [x] serviço systemd endurecido e atualização segura;
- [x] liveness/readiness e smoke real de produção;
- [x] Tailscale Serve privado com HTTPS;
- [x] Tailscale Funnel opcional para exposição pública consciente;
- [x] FFmpeg/FFprobe, transcoding adaptativo e perfis de qualidade;
- [x] letras locais;
- [x] ReplayGain/normalização;
- [x] estatísticas pessoais;
- [x] integração Rekordbox XML.

## Fase 7 — Experiência desktop

Concluída para o escopo original.

- [x] Desktop Shell responsivo;
- [x] player persistente em barra inferior;
- [x] biblioteca desktop em tabela/lista;
- [x] fila e letras em painel contextual;
- [x] navegação desktop completa;
- [x] atalhos de teclado;
- [x] seleção múltipla e ações em lote;
- [x] downloads offline no desktop reutilizando o scheduler global;
- [x] drag-and-drop/reordenação da fila;
- [x] baseline Playwright mobile/tablet/desktop.

## Fase 7.5 — Identidade, multiusuário e autorização

Concluída.

O Home Music usa contas persistidas no SQLite com papéis `admin` e `user`, sessões opacas, autorização fail-closed no backend e ownership por usuário para dados pessoais.

- [x] schema e migrations de usuários;
- [x] hashing `scrypt` e senhas temporárias;
- [x] bootstrap do primeiro administrador;
- [x] sessão associada a `userId`;
- [x] política central `public / authenticated / admin`;
- [x] APIs administrativas de usuários;
- [x] proteção do último administrador e contra auto-lockout;
- [x] troca obrigatória de senha temporária;
- [x] autosserviço de senha e sessões;
- [x] ownership de favoritos, histórico, estatísticas, playlists manuais e estado do player;
- [x] downloads offline isolados por usuário;
- [x] auditoria de IDOR/ownership;
- [x] recuperação local de administrador sem depender permanentemente do `.env`;
- [x] regressões de segurança e smoke de produção multiusuário.

Documentação principal: [multi-user-auth.md](multi-user-auth.md), [phase-7.5-operations.md](phase-7.5-operations.md) e [phase-7.5-my-account-screen.md](phase-7.5-my-account-screen.md).

## Fase 8 — Administração da biblioteca

Concluída para o escopo planejado.

- [x] Administração separada e exclusiva de `admin` (#75);
- [x] visão geral operacional da biblioteca (#77);
- [x] entrada de importação integrada ao pipeline (#79);
- [x] desativar/reativar músicas (#83);
- [x] lixeira/quarentena com restauração e exclusão permanente (#84);
- [x] ações administrativas em lote (#85);
- [x] overrides de metadados não destrutivos (#86);
- [x] overrides de capa seguros (#87);
- [x] movimentação/organização física confinada a `MUSIC_DIR` (#88);
- [x] armazenamento e limpeza segura do cache de transcoding (#89);
- [x] histórico operacional de scans/importações (#90);
- [x] backup e restore consistentes, documentados e testados (#91).

A escrita opcional de metadata/capa de volta ao arquivo físico continua fora do comportamento padrão. Se for implementada futuramente, deverá ser operação explícita, reversível quando possível e tratada em issue própria.

A [#251](https://github.com/felipe-urgal/home-music/issues/251) foi entregue pelo PR #252 como correção transversal: overrides persistidos agora são projetados antes do snapshot/cache HTTP e reconciliados imediatamente no player e no painel de saúde, sem rescan e sem alterar o arquivo físico.

## Fase 9 — Importação de mídia

Concluída para o pipeline planejado, com melhorias posteriores também incorporadas.

- [x] modelo de jobs/fila com estados persistíveis (#79);
- [x] staging temporário fora de `MUSIC_DIR` (#92);
- [x] upload/drag-and-drop com progresso (#93);
- [x] importação por URL com proteção contra SSRF (#94);
- [x] avaliação de engines externas (#95);
- [x] arquitetura desacoplada de providers (#96);
- [x] validação FFmpeg/ffprobe e perfis de saída (#97);
- [x] preview de metadata antes da promoção (#98);
- [x] detecção de possíveis duplicatas (#99);
- [x] destino seguro, no-clobber e confinement em `MUSIC_DIR` (#100);
- [x] cleanup de staging em sucesso/falha/cancelamento/restart (#101);
- [x] retry e diagnóstico de jobs (#102);
- [x] atualização incremental da biblioteca após promoção (#103);
- [x] primeiro provider externo via `yt-dlp` (#104);
- [x] importação de playlists/lotes por provider externo (#154);
- [x] happy path automatizado com pausa somente para exceções (#156).

A superfície atual de importação usa um workbench em quatro etapas — **Origem → Preparar → Revisar → Biblioteca** — sem alterar as invariantes do pipeline.

## Fase 10 — Saúde e inteligência da biblioteca

Concluída para o backlog planejado atual.

- [x] painel de saúde com indicadores reais (#105);
- [x] identificação de título/capa/artista/álbum/duração ausentes ou desconhecidos (#105);
- [x] auditoria read-only de falhas de scanner/FFprobe, arquivos ausentes e arquivos fora do índice (#106);
- [x] snapshot e data da última verificação de integridade (#106);
- [x] armazenamento de biblioteca, SQLite e cache no painel administrativo (#105);
- [x] [#107](https://github.com/felipe-urgal/home-music/issues/107) — revisar possíveis músicas duplicadas na biblioteca existente;
- [x] [#108](https://github.com/felipe-urgal/home-music/issues/108) — smart playlists por regras, calculadas dinamicamente com ownership por usuário e preview antes de salvar;
- [x] [#109](https://github.com/felipe-urgal/home-music/issues/109) — views pessoais que persistem busca, formato, capa e ordenação e reaplicam somente filtros compatíveis;
- [x] [#110](https://github.com/felipe-urgal/home-music/issues/110) — normalização lógica, revisável e reversível de variações de grafia de artistas e álbuns.

Smart playlists não materializam faixas em `playlist_tracks`; a definição persistida é avaliada contra biblioteca, favoritos e histórico do usuário. Detalhes: [smart-playlists.md](smart-playlists.md).

Views inteligentes também não materializam faixas: cada usuário persiste apenas a definição da view, enquanto a filtragem continua centralizada no motor da biblioteca. Detalhes: [library-views.md](library-views.md).

A normalização lógica preserva a metadata física e compõe a visão canônica depois dos overrides por faixa, com aliases de artista globais e aliases de álbum escopados pelo artista canônico. Detalhes: [library-metadata-normalization.md](library-metadata-normalization.md).

A auditoria de Integridade permanece **somente leitura**. `Verificar agora` não remove arquivos nem registros; reconciliação continua pertencendo ao scan normal.

## Redesign administrativo — 2026

Ciclo concluído para as superfícies planejadas, mantendo as regras de segurança/backend existentes:

- [x] Administração em cockpit compacto (#172);
- [x] Gerenciar músicas com lista limpa, menu contextual e lote sob demanda (#173);
- [x] Metadados como workspace lista + editor persistente (#177);
- [x] Importação como workbench progressivo (#178);
- [x] Integridade como cockpit diagnóstico e Minha conta com largura fluida (#179);
- [x] Usuários com tabela + inspetor e fluxos focados de criar/editar (#180);
- [x] Lixeira com lista ampla + inspetor lateral, restauração priorizada e delete permanente isolado (#181).

A composição atual está documentada em [administration-ui.md](administration-ui.md).

## Fase 11 — Engenharia, arquitetura e qualidade

**Concluída para o backlog planejado #111–#122.**

- [x] [#111](https://github.com/felipe-urgal/home-music/issues/111) — Playwright E2E consolidado como gate obrigatório para fluxos críticos;
- [x] [#112](https://github.com/felipe-urgal/home-music/issues/112) — URLs reais e deep links;
- [x] [#113](https://github.com/felipe-urgal/home-music/issues/113) — refatoração de `LibraryScreen`;
- [x] [#114](https://github.com/felipe-urgal/home-music/issues/114) — refatoração de `PlayerScreen` sem duplicar estado;
- [x] [#115](https://github.com/felipe-urgal/home-music/issues/115) — redução de responsabilidade de `App.tsx`;
- [x] [#116](https://github.com/felipe-urgal/home-music/issues/116) — separação de rotas Fastify, serviços e infraestrutura;
- [x] [#117](https://github.com/felipe-urgal/home-music/issues/117) — serviços explícitos para operações destrutivas/imports/backups — PR #198;
- [x] [#118](https://github.com/felipe-urgal/home-music/issues/118) — regressões negativas dedicadas de segurança — PR #199;
- [x] [#119](https://github.com/felipe-urgal/home-music/issues/119) — benchmark com biblioteca grande — PR #204;
- [x] [#120](https://github.com/felipe-urgal/home-music/issues/120) — revisão sistemática de acessibilidade — PR #205;
- [x] [#121](https://github.com/felipe-urgal/home-music/issues/121) — observabilidade correlacionada de jobs longos — PR #206;
- [x] [#122](https://github.com/felipe-urgal/home-music/issues/122) — revisão periódica e segura de dependências — PR #207.

A #118 mantém `npm run test:security` como gate explícito. A #119 mantém `npm run benchmark:large-library`. A #120 documenta a baseline em [accessibility.md](accessibility.md). A #121 documenta o lifecycle em [long-job-observability.md](long-job-observability.md). A #122 documenta Dependabot/majors/supply chain em [dependency-management.md](dependency-management.md).

O PR #207 foi mergeado em 2026-09-01 com CI completo verde e encerrou o backlog técnico planejado dessa fase. Novas atividades de engenharia devem ser abertas e priorizadas em issue própria e refletidas neste roadmap; não reutilizar artificialmente a #123 nem manter a #122 como “atividade atual”.

## Fase 12 — Segurança e Performance

**Concluída em 2026-09-04.** O índice executivo [#239](https://github.com/felipe-urgal/home-music/issues/239) foi reconciliado e encerrado.

### P0

- [x] [#228](https://github.com/felipe-urgal/home-music/issues/228) — isolamento de sessões entre usuários — entregue pelo PR #241;
- [x] [#229](https://github.com/felipe-urgal/home-music/issues/229) — proteção adicional contra brute force e abuso de CPU no login — entregue pelo PR #242;
- [x] [#230](https://github.com/felipe-urgal/home-music/issues/230) — backpressure e limites para filas de trabalho pesado — entregue pelo PR #243;
- [x] [#233](https://github.com/felipe-urgal/home-music/issues/233) — concorrência limitada no scan da biblioteca — entregue pelo PR #245;
- [x] [#234](https://github.com/felipe-urgal/home-music/issues/234) — persistência SQLite somente por delta do scan — entregue pelo PR #247;
- [x] [#235](https://github.com/felipe-urgal/home-music/issues/235) — revision, ETag e compressão da biblioteca — entregue pelo PR #248.

### P1

- [x] [#231](https://github.com/felipe-urgal/home-music/issues/231) — filesystem do serviço systemd com escrita mínima — entregue pelo PR #253;
- [x] [#232](https://github.com/felipe-urgal/home-music/issues/232) — hardening da instalação de dependências npm — concluída;
- [x] [#236](https://github.com/felipe-urgal/home-music/issues/236) — code splitting das telas secundárias — entregue pelo PR #249;
- [x] [#237](https://github.com/felipe-urgal/home-music/issues/237) — benchmark de biblioteca grande em navegador real — entregue pelo PR #244;
- [x] [#238](https://github.com/felipe-urgal/home-music/issues/238) — reduzir recomputações da navegação da biblioteca — entregue pelo PR #250.

### Correções transversais

- [x] [#251](https://github.com/felipe-urgal/home-music/issues/251) — propagar overrides de metadados para snapshot/cache HTTP, player e saúde administrativa — entregue pelo PR #252;
- [x] [#255](https://github.com/felipe-urgal/home-music/issues/255) — regressão de reprodução contínua no PWA em background;
- [x] [#258](https://github.com/felipe-urgal/home-music/issues/258) — bootstrap offline-first da biblioteca baixada;
- [x] [#259](https://github.com/felipe-urgal/home-music/issues/259) — testes e documentação do contrato de bootstrap offline.

## Fase 13 — Ecossistema aberto e interoperabilidade

**Concluída em 2026-09-05.** O índice executivo [#266](https://github.com/felipe-urgal/home-music/issues/266) foi encerrado após a conclusão técnica e o aceite final autorizado. O PR #276 estabeleceu a entrega técnica de P0 + P1; a revisão sênior posterior abriu #278–#282, todos concluídos e integrados à `main`.

### P0 — Jamendo

A [#262](https://github.com/felipe-urgal/home-music/issues/262) integra descoberta e importação física de música livre/licenciada ao pipeline seguro existente, sem criar uma segunda biblioteca ou caminho paralelo de promoção.

- [x] registrar `JamendoProvider` no `ExternalProviderImportManager` com capabilities reais;
- [x] configuração server-side por `HOME_MUSIC_JAMENDO_CLIENT_ID` e status `configured` sem expor o segredo;
- [x] busca paginada server-side e normalização sem devolver URLs de preview/download;
- [x] tela simples de Descobrir/Importar no workbench;
- [x] licença/atribuição e disponibilidade de download antes da confirmação;
- [x] download permitido para scratch privado com limites e egress seguro;
- [x] staging, validação, metadata, duplicatas, promoção e indexação pelo pipeline comum;
- [x] negativos de rate limit, resposta malformada, redirect inseguro, conteúdo removido e payload inválido;
- [x] fakes locais/CI sem internet pública;
- [x] documentação final reconciliada no PR #276.

Detalhes: [jamendo.md](jamendo.md).

### P1 — OpenSubsonic

A [#264](https://github.com/felipe-urgal/home-music/issues/264) é implementada como adapter de protocolo, sem segundo scanner, catálogo ou store pessoal.

- [x] matriz `endpoint → serviço Home Music` documentada antes dos handlers;
- [x] API keys dedicadas, revogáveis e persistidas somente em forma hash;
- [x] biblioteca, artistas, álbuns, faixas, diretórios e busca sobre `LibraryService`;
- [x] streaming HTTP Range, artwork, lyrics e transcoding delegado à infraestrutura existente;
- [x] playlists, favoritos e scrobble derivados do `userId` autenticado;
- [x] testes HTTP locais de contrato, ownership/IDOR, Range e endpoints não suportados;
- [x] redaction de query string para impedir vazamento de `apiKey` em logs;
- [x] registrar aceite manual real com Feishin: autenticação por username + API key com Legacy Authentication, biblioteca, reprodução e seek/HTTP Range aprovados; Symfonium permaneceu não executado e foi dispensado explicitamente no aceite final.

#### Follow-ups técnicos pós-implementação

- [x] [#278](https://github.com/felipe-urgal/home-music/issues/278) — projeções de catálogo/favoritos sob demanda nos fast paths OpenSubsonic — entregue pelo PR #286;
- [x] [#279](https://github.com/felipe-urgal/home-music/issues/279) — schema de credenciais versionado na migration SQLite v12 e backup/restore alinhado — entregue pelo PR #287;
- [x] [#280](https://github.com/felipe-urgal/home-music/issues/280) — reconciliação causal da UI de API keys contra respostas assíncronas obsoletas — entregue pelo PR #283;
- [x] [#281](https://github.com/felipe-urgal/home-music/issues/281) — contrato HTTP público de chaves centralizado em `@home-music/shared/open-subsonic` — entregue pelo PR #284;
- [x] [#282](https://github.com/felipe-urgal/home-music/issues/282) — validação dos parâmetros comuns `v`/`c` e compatibilidade de protocolo — entregue pelo PR #285.

Os cinco follow-ups foram reconciliados sequencialmente contra a `main`, passaram `npm run check` no head final e, após a migration v12, os CIs de integração também passaram `Backup restore smoke`. Os gates automatizados não simulam evidência de cliente real: a evidência manual registrada é a execução do Feishin; Symfonium permanece explicitamente como não executado na matriz.

Detalhes: [open-subsonic.md](open-subsonic.md).

## Fase 14 — Soberania e recuperação

**Em pausa após a conclusão da Onda 1.** O índice executivo é a [#295](https://github.com/felipe-urgal/home-music/issues/295).

O objetivo é tornar o Home Music mais seguro para evoluir, migrar e abandonar sem prender o usuário ao banco interno, mantendo a biblioteca física, `MUSIC_DIR` e os serviços atuais como autoridades.

### P0

- [x] [#291](https://github.com/felipe-urgal/home-music/issues/291) — `service:update` recuperável com checkpoint pré-update verificável — entregue pelo PR #297;
- [x] [#292](https://github.com/felipe-urgal/home-music/issues/292) — exportação de dados pessoais em bundle portátil v1 — entregue pelo PR #298.

### P1

- [ ] [#293](https://github.com/felipe-urgal/home-music/issues/293) — importar dados pessoais com preview e matching seguro; a dependência da #292 está satisfeita e a implementação está **desbloqueada, porém pausada**;
- [x] [#294](https://github.com/felipe-urgal/home-music/issues/294) — interoperabilidade segura de playlists por M3U8 — entregue pelo PR #299.

### Ordem e paralelismo

A Onda 1 (#291, #292 e #294) está concluída e integrada à `main`. A #293 é a única pendência da fase e deve usar o formato `home-music-personal-data` v1 e o `PortableTrackReferenceV1` já estabilizados pela #292, sem criar contrato concorrente. Não há P2 planejado neste ciclo; novos itens exigem evidência concreta.

## Backlog visual e PWA

- [x] [#175](https://github.com/felipe-urgal/home-music/issues/175) — fallback visual consistente e centralizado para músicas sem capa — entregue pelo PR #221; política em [artwork-fallback.md](artwork-fallback.md);
- [x] [#176](https://github.com/felipe-urgal/home-music/issues/176) — identidade Casa + vinil para favicon/PWA, variantes `any`/`maskable` e integração iOS/Safari — entregue pelo PR #222; política em [pwa-icon-identity.md](pwa-icon-identity.md).

Esses itens são independentes da #174 e da #81, ambas concluídas.

## Backlog atual

A #293 é a única atividade implementável ainda aberta na Fase 14. Ela está desbloqueada pelo merge da #292, mas deliberadamente pausada até a próxima retomada. A #295 permanece aberta como índice executivo; #291, #292 e #294 estão concluídas. A #266, a #239 e a #123 permanecem encerradas como registros de ciclos anteriores e não devem ser reabertas artificialmente para representar trabalho novo.

## Regra de execução

O padrão obrigatório vive em [`../AGENTS.md`](../AGENTS.md). Em resumo:

```text
issue/escopo
   ↓
branch própria
   ↓
investigação + implementação
   ↓
testes focados e amplos
   ↓
auto code review completo
   ↓
correções
   ↓
review + CI novamente no head final
   ↓
APPROVE / MERGE
```

Nenhuma mudança destrutiva deve ser considerada pronta sem revisão explícita das invariantes de segurança correspondentes. `BLOCKER`, `HIGH` ou `MEDIUM` conhecidos bloqueiam merge até correção.
