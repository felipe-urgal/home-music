# Roadmap

Este documento é a visão técnica de alto nível do Home Music. A issue [#123](https://github.com/felipe-urgal/home-music/issues/123) é o índice executivo das pendências abertas.

> Estado revisado em 2026-09-01. Itens marcados como concluídos refletem funcionalidades já entregues ou concluídas pelo próprio PR que atualiza este documento; itens futuros apontam para a issue que mantém escopo e gate atualizados.

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

A experiência principal está concluída. Restam validações/evoluções explícitas.

- [x] shuffle e repeat `off / all / one`;
- [x] fila reordenável;
- [x] estado do player persistente e retomada quando permitida pelo navegador;
- [x] Media Session e controles de sistema;
- [x] continuidade da reprodução em background dentro dos limites do navegador;
- [x] autenticação própria responsiva;
- [x] layout sem overflow horizontal;
- [x] download offline individual e em lote com scheduler global de até 3 operações;
- [x] isolamento de cache/manifesto offline por usuário;
- [ ] [#81](https://github.com/felipe-urgal/home-music/issues/81) — validar downloads em background/tela bloqueada em Android e iPhone/iPad;
- [ ] [#174](https://github.com/felipe-urgal/home-music/issues/174) — disponibilizar playlists e pastas completas offline com deduplicação física por faixa.

Detalhes: [offline-downloads.md](offline-downloads.md).

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

Em andamento. As issues abaixo são a fonte de escopo:

- [x] [#111](https://github.com/felipe-urgal/home-music/issues/111) — Playwright E2E consolidado como gate obrigatório para fluxos críticos, com fixtures isoladas de dados reais e internet pública;
- [x] [#112](https://github.com/felipe-urgal/home-music/issues/112) — URLs reais e deep links;
- [x] [#113](https://github.com/felipe-urgal/home-music/issues/113) — refatorar `LibraryScreen`;
- [x] [#114](https://github.com/felipe-urgal/home-music/issues/114) — refatorar `PlayerScreen` sem duplicar estado;
- [x] [#115](https://github.com/felipe-urgal/home-music/issues/115) — reduzir responsabilidade de `App.tsx`;
- [x] [#116](https://github.com/felipe-urgal/home-music/issues/116) — separar rotas Fastify, serviços e infraestrutura;
- [x] [#117](https://github.com/felipe-urgal/home-music/issues/117) — serviços explícitos para operações destrutivas/imports/backups, mantendo stores/managers seguros existentes como primitivas e preservando contratos;
- [x] [#118](https://github.com/felipe-urgal/home-music/issues/118) — suíte dedicada de regressões negativas para importação/administração, com gate explícito no CI;
- [x] [#119](https://github.com/felipe-urgal/home-music/issues/119) — benchmark com biblioteca grande, concluído pelo PR #204 com dataset sintético, baseline versionada e gate próprio de CI;
- [ ] [#120](https://github.com/felipe-urgal/home-music/issues/120) — revisão sistemática de acessibilidade;
- [ ] [#121](https://github.com/felipe-urgal/home-music/issues/121) — observabilidade de jobs longos;
- [ ] [#122](https://github.com/felipe-urgal/home-music/issues/122) — revisão periódica de dependências.

A fronteira de serviços da #117 está detalhada em [server-composition.md](server-composition.md). Operações destrutivas continuam delegando confinement/lock/rollback aos stores físicos existentes; importações continuam usando o mesmo pipeline; backup/restore continua usando validação e rollback de `backup-restore.ts`.

A #118 adiciona `npm run test:security` como gate explícito do CI. A suíte transversal fixa regressões de RBAC/anti-CSRF, upload, SSRF/redirects, confinement/symlink/no-clobber, lixeira/delete permanente, providers/processos filhos e Integridade read-only usando fixtures isoladas e sem rede pública. Detalhes: [security-regressions.md](security-regressions.md).

A #119 adiciona `npm run benchmark:large-library` como gate de regressão grave separado da suíte funcional. O servidor mede scanner inicial/incremental, payload e memória com 2.000 WAV sintéticos; o frontend mede decode, projeção de pastas, busca/filtros/ordenação, SSR da primeira página e memória com 10.000 faixas sintéticas. A baseline inicial do código foi aceita no GitHub Actions run `33497407869`, commit `f357a2dc8776e1fa0d305fec0893191cfba4af7b`, em Node.js 22/`ubuntu-latest`. O PR #204 foi ampliado, por decisão explícita, para consolidar documentação e backlog; por isso o merge continua condicionado a auto-review e CI completo no head final após essa consolidação. Detalhes: [large-library-benchmark.md](large-library-benchmark.md).

**Ordem técnica atual:** após o merge do PR #204/#119, a próxima atividade da Fase 11 é a #120. #121 e #122 permanecem na sequência, salvo repriorização explícita registrada em #123 e neste roadmap.

## Backlog visual e PWA

- [ ] [#175](https://github.com/felipe-urgal/home-music/issues/175) — fallback visual consistente para músicas sem capa;
- [ ] [#176](https://github.com/felipe-urgal/home-music/issues/176) — novo ícone/identidade visual da PWA.

Esses itens são backlog independente da sequência técnica da Fase 11 e podem ser repriorizados sem reabrir o redesign administrativo já concluído.

## Backlog aberto após este PR

Enquanto #119 só fecha no merge do PR #204, as pendências executivas abertas são #81, #119–#123 e #174–#176. A #123 é somente o índice executivo; as implementações/validações reais são #81, #119–#122 e #174–#176.

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
