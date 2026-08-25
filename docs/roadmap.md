# Roadmap

## Fase 1 — Caminho crítico

- [x] Scanner de músicas
- [x] API de biblioteca
- [x] Streaming com HTTP Range
- [x] Player mobile
- [x] Fila contextual
- [x] Busca básica
- [x] PWA básica

## Fase 2 — Biblioteca pessoal

- [x] SQLite
- [x] Favoritos persistentes
- [x] Histórico / recentes
- [x] Playlists
- [x] Navegação hierárquica por pastas e subpastas
- [x] Re-scan incremental manual
- [x] Re-scan automático periódico opcional
- [x] Ordenação e filtros avançados

## Fase 3 — Experiência mobile

- [x] Shuffle
- [x] Repeat `off / all / one`
- [x] Fila reordenável
- [x] Volume e estado do player persistentes
- [x] Play automático entre faixas
- [x] Pré-aquecimento da próxima faixa quando o perfil exige transcoding
- [x] Continuidade de reprodução no iPhone/iPad em background/tela bloqueada
- [x] Retomada automática da sessão quando permitida pelo navegador
- [x] Media Session API
- [x] Controles compatíveis na tela bloqueada/notificações
- [x] Login próprio responsivo sem popup de Basic Auth
- [x] Sessão por cookie HttpOnly
- [x] Layout sem overflow horizontal em telas estreitas
- [x] Capas confinadas sem quebrar a viewport
- [x] Download offline
- [x] Cache seletivo
- [x] Melhor tratamento de capas ausentes

## Fase 4 — Operação no Ubuntu

- [x] Build React servido pelo Fastify
- [x] Frontend + API em uma única porta/processo
- [x] `npm start` de produção
- [x] Cache seguro com `immutable` somente para assets hashados
- [x] Liveness público mínimo + readiness separado
- [x] Diagnóstico detalhado autenticado em `/api/health`
- [x] Shutdown limpo Fastify + SQLite, inclusive durante scan
- [x] Serviço systemd com restart automático e journal
- [x] Update seguro sem versão híbrida de frontend
- [x] Permissões endurecidas para `.env`, `data/` e SQLite
- [x] Escaping de caminhos no unit systemd
- [x] Cookie `Secure` configurável explicitamente para proxy HTTPS confiável
- [x] Smoke test real de `npm start` no CI
- [x] Hardening do processo systemd

## Fase 5 — Fora de casa

- [x] Tailscale Serve privado ao tailnet
- [x] HTTPS automático `*.ts.net`
- [x] Backend restrito a loopback no perfil remoto
- [x] Cookie `Secure` no perfil HTTPS
- [x] Setup/rollback idempotente com proteção contra conflito em 443
- [x] Aplicar grants/restrições least-privilege no tailnet real ([guia](tailscale-hardening.md))
- [x] Acesso remoto HTTPS sem exigir cliente Tailscale no celular
- [x] FFmpeg
- [x] Transcoding adaptativo
- [x] Perfis de qualidade Wi‑Fi / 4G

## Fase 6 — Extras

- [x] Letras — exibir o controle somente quando houver letra local
- [x] ReplayGain / normalização opcional
- [x] Estatísticas pessoais
- [x] Integração opcional com biblioteca DJ — importação/sincronização de playlists via Rekordbox XML

## Fase 7 — Experiência desktop

Objetivo: evoluir a interface para desktop sem regredir o fluxo mobile Player First e sem duplicar a aplicação React.

- [x] Adicionar baseline Playwright E2E para login, biblioteca e player em viewport mobile e desktop
- [x] Criar Desktop Shell responsivo com sidebar, conteúdo principal e área contextual
- [x] Preservar a experiência mobile atual com composição específica por breakpoint
- [ ] Criar player desktop persistente em barra inferior
- [ ] Criar biblioteca desktop em tabela/lista densa com colunas úteis e ordenação
- [ ] Exibir fila e letras em painel lateral quando houver espaço
- [ ] Criar navegação desktop para músicas, artistas, álbuns, pastas, favoritos, playlists, Rekordbox e estatísticas
- [ ] Adicionar atalhos de teclado para play/pause, próxima/anterior, seek, busca e volume quando aplicável
- [ ] Adicionar seleção múltipla de faixas e ações em lote
- [ ] Melhorar drag-and-drop/reordenação da fila para mouse sem prejudicar touch
- [ ] Garantir estados vazios, loading, erros e mini-player coerentes nos dois layouts

## Fase 8 — Administração da biblioteca

Objetivo: permitir administrar a coleção pelo próprio Home Music, com operações seguras e reversíveis sempre que possível.

- [ ] Criar área `Administração` separada da experiência de reprodução
- [ ] Criar visão geral com quantidade de faixas, armazenamento, problemas e estado do scanner
- [ ] Criar ponto de entrada `Importar mídia` integrado ao pipeline da Fase 9
- [ ] Permitir desativar/reativar músicas sem remover o arquivo físico
- [ ] Criar lixeira/quarentena com restauração antes da exclusão permanente
- [ ] Permitir exclusão física somente após confirmação explícita
- [ ] Adicionar ações em lote para ativar, desativar, mover, excluir, favoritar e adicionar a playlists
- [ ] Permitir editar metadados por override não destrutivo no SQLite
- [ ] Avaliar escrita opcional de metadados de volta ao arquivo somente como operação explícita
- [ ] Permitir adicionar/substituir capa sem destruir o arquivo original por padrão
- [ ] Permitir mover/organizar arquivos dentro de `MUSIC_DIR` com validação de caminhos e rollback quando possível
- [ ] Exibir armazenamento usado pela biblioteca e pelo cache de transcoding
- [ ] Permitir limpar cache de transcoding pela administração
- [ ] Exibir histórico e resultado dos scans/importações com erros acionáveis
- [ ] Criar backup consistente do SQLite e configuração operacional sem incluir segredos em claro
- [ ] Criar fluxo documentado e testado de restore

## Fase 9 — Importação de mídia

Objetivo: centralizar entradas de mídia em um pipeline seguro, observável e extensível por providers.

- [ ] Criar modelo de job/fila de importação com estados `pending / processing / completed / failed / cancelled`
- [ ] Criar staging temporário separado de `MUSIC_DIR` e promover o arquivo somente após validação
- [ ] Adicionar importação por drag-and-drop/upload com progresso
- [ ] Adicionar importação por URL direta de mídia suportada
- [ ] Criar arquitetura de providers desacoplados para fontes externas
- [ ] Avaliar/implementar provider opcional para YouTube no uso pessoal, isolado do pipeline principal
- [ ] Para provider YouTube, selecionar a melhor fonte de áudio disponível antes de qualquer conversão
- [ ] Preservar o formato/qualidade original por padrão e converter somente quando necessário ou solicitado
- [ ] Oferecer perfis de saída como `original`, `economizar espaço` e `compatibilidade máxima`
- [ ] Usar FFmpeg/ffprobe para validar mídia, duração, codec e conversões necessárias
- [ ] Extrair título, artista, álbum e capa quando a fonte fornecer metadata confiável
- [ ] Exibir preview antes de confirmar a entrada definitiva na biblioteca
- [ ] Detectar possíveis duplicatas por hash, duração, nome e metadata antes de importar
- [ ] Definir nomes de arquivo e destino sem colisões e sem path traversal
- [ ] Aplicar limites de tamanho, tempo, protocolos e destinos de URL para evitar abuso/SSRF
- [ ] Limpar arquivos temporários em sucesso, falha, cancelamento e restart do serviço
- [ ] Criar histórico de importações com retry e diagnóstico de falha
- [ ] Disparar atualização incremental da biblioteca após importação concluída

## Fase 10 — Saúde e inteligência da biblioteca

Objetivo: ajudar a manter uma coleção grande organizada e detectar problemas sem depender de inspeção manual dos arquivos.

- [ ] Criar painel de saúde da biblioteca
- [ ] Identificar faixas sem artista, álbum, título, duração ou capa
- [ ] Identificar arquivos que falham no scanner/ffprobe
- [ ] Identificar possíveis duplicatas e permitir revisão antes de qualquer ação destrutiva
- [ ] Identificar registros órfãos ou inconsistentes no SQLite
- [ ] Criar smart playlists por regras como mais tocadas, recentes, nunca tocadas e favoritas antigas
- [ ] Permitir combinar filtros de artista, álbum, pasta, favorito, histórico e período nas smart playlists
- [ ] Permitir salvar filtros da biblioteca como views inteligentes
- [ ] Melhorar tratamento de artistas/álbuns duplicados por variações de grafia sem alterar arquivos automaticamente
- [ ] Exibir integridade e tamanho de cache, banco e biblioteca no painel administrativo

## Fase 11 — Engenharia, arquitetura e qualidade

Objetivo: sustentar a evolução do produto reduzindo acoplamento e aumentando a segurança contra regressões.

- [ ] Expandir Playwright E2E para fila, playlists, offline e administração
- [ ] Introduzir navegação com URLs reais/deep links para telas e entidades relevantes
- [ ] Refatorar `LibraryScreen` em componentes/hooks menores orientados por responsabilidade
- [ ] Refatorar `PlayerScreen` em componentes/hooks menores sem duplicar estado de reprodução
- [ ] Reduzir responsabilidade de `App.tsx` separando composição, navegação e orquestração
- [ ] Separar rotas Fastify, serviços de domínio e infraestrutura atualmente concentrados no bootstrap do servidor
- [ ] Criar serviços explícitos para operações destrutivas de arquivos, imports e backups com testes próprios
- [ ] Adicionar testes de regressão de segurança para upload, importação por URL, path traversal e operações administrativas
- [ ] Adicionar benchmark/teste de performance com biblioteca grande para scanner, busca e renderização
- [ ] Revisar acessibilidade de teclado, foco, labels e contraste em mobile e desktop
- [ ] Melhorar observabilidade de jobs longos com logs estruturados e identificador de operação
- [ ] Automatizar revisão periódica de dependências sem fazer updates destrutivos automaticamente
