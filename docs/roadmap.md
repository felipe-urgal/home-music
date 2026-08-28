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
- [x] Até 3 downloads offline simultâneos com continuidade entre telas ([detalhe](offline-downloads.md))
- [ ] Validar downloads offline com celular ocioso/em background e tela bloqueada em Android e iPhone/iPad antes de considerar continuidade garantida ([matriz de validação](offline-downloads.md))
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
- [x] Criar player desktop persistente em barra inferior
- [x] Criar biblioteca desktop em tabela/lista densa com colunas úteis e ordenação
- [x] Exibir fila e letras em painel lateral quando houver espaço
- [x] Criar navegação desktop para músicas, artistas, álbuns, pastas, favoritos, playlists, Rekordbox e estatísticas
- [x] Adicionar atalhos de teclado para play/pause, próxima/anterior, seek, busca e volume quando aplicável
- [x] Adicionar seleção múltipla de faixas e ações em lote
- [ ] Adicionar download offline individual e múltiplo na tabela/seleção desktop, reutilizando o scheduler global atual de até 3 operações simultâneas
- [x] Melhorar drag-and-drop/reordenação da fila para mouse sem prejudicar touch
- [x] Garantir estados vazios, loading, erros e mini-player coerentes nos dois layouts

## Fase 7.5 — Identidade, multiusuário e autorização

Objetivo: criar uma fronteira de identidade e autorização segura antes de introduzir operações administrativas. A biblioteca física continua compartilhada, enquanto dados pessoais e estado de reprodução passam a ser isolados por usuário. Não haverá cadastro público: somente administradores autenticados poderão criar e gerenciar contas.

Decisões, invariantes de segurança e desenho detalhado: [multi-user-auth.md](multi-user-auth.md).
Runbook operacional de identidade e usuários: [phase-7.5-operations.md](phase-7.5-operations.md).
Detalhe da migração do primeiro administrador: [phase-7.5-bootstrap.md](phase-7.5-bootstrap.md).
Detalhe das sessões associadas à identidade: [phase-7.5-sessions.md](phase-7.5-sessions.md).
Detalhe do status de autenticação e identidade mínima: [phase-7.5-auth-status.md](phase-7.5-auth-status.md).
Detalhe do contexto autenticado e política central de acesso: [phase-7.5-auth-policy.md](phase-7.5-auth-policy.md).
Detalhe da proteção das rotas administrativas existentes: [phase-7.5-admin-routes.md](phase-7.5-admin-routes.md).
Detalhe das APIs administrativas de usuários: [phase-7.5-admin-users-api.md](phase-7.5-admin-users-api.md).
Detalhe da troca obrigatória de senha: [phase-7.5-required-password-change.md](phase-7.5-required-password-change.md).
Detalhe do autosserviço de senha e sessões: [phase-7.5-self-service-account.md](phase-7.5-self-service-account.md).
Detalhe do ownership de favoritos por usuário: [phase-7.5-favorites-ownership.md](phase-7.5-favorites-ownership.md).
Detalhe do ownership de histórico e estatísticas por usuário: [phase-7.5-history-ownership.md](phase-7.5-history-ownership.md).
Detalhe do ownership de playlists manuais: [phase-7.5-manual-playlist-ownership.md](phase-7.5-manual-playlist-ownership.md).
Detalhe do ownership do estado do player: [phase-7.5-playback-state-ownership.md](phase-7.5-playback-state-ownership.md).
Detalhe da auditoria de IDOR e queries por ownership: [phase-7.5-idor-ownership-audit.md](phase-7.5-idor-ownership-audit.md).
Detalhe do isolamento dos downloads offline por usuário: [offline-downloads.md](offline-downloads.md).
Detalhe do `currentUser` e superfícies por role no frontend: [phase-7.5-frontend-role-surfaces.md](phase-7.5-frontend-role-surfaces.md).
Detalhe da tela administrativa de usuários: [phase-7.5-admin-users-screen.md](phase-7.5-admin-users-screen.md).
Detalhe da tela de autosserviço da conta: [phase-7.5-my-account-screen.md](phase-7.5-my-account-screen.md).
Detalhe da remoção das credenciais permanentes e recuperação local: [phase-7.5-remove-env-auth-recovery.md](phase-7.5-remove-env-auth-recovery.md).

Princípios:

- autorização é aplicada no backend e falha fechado; esconder menus no frontend é somente uma melhoria de UX;
- toda rota exige a menor permissão necessária, com `deny by default` e proteção centralizada para evitar rotas administrativas esquecidas;
- contas usam papéis `admin` e `user`, com ownership para recursos pessoais e `404` para recursos de outro usuário quando não for necessário revelar sua existência;
- senhas nunca são persistidas em claro; usar `scrypt` do `node:crypto` com salt aleatório, parâmetros versionados e comparação em tempo constante;
- sessão permanece opaca em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em HTTPS, mas passa a resolver `token -> userId -> usuário/role/enabled` no servidor;
- alteração de senha, papel ou estado da conta revoga sessões afetadas; usuário desativado perde acesso imediatamente;
- nunca permitir zero administradores ativos;
- operações administrativas destrutivas futuras deverão exigir autenticação recente quando aplicável;
- migrations devem ser transacionais e preservar os dados existentes do usuário atual.

Sequência de implementação:

- [x] Criar schema de `users` com `id`, `username`, username normalizado único, `password_hash`, `role`, `enabled`, timestamps e flag de troca obrigatória de senha
- [x] Implementar hashing/verificação de senha com `scrypt`, formato versionado e limites defensivos de entrada
- [x] Criar bootstrap/migration idempotente do usuário atual de `HOME_MUSIC_USER`/`HOME_MUSIC_PASSWORD` para o primeiro `admin`, sem perder acesso durante o upgrade
- [x] Evoluir `SessionManager` para associar sessão a `userId`, manter token aleatório opaco e permitir revogação de todas as sessões de um usuário
- [x] Fazer `/api/auth/status` retornar a identidade autenticada mínima (`id`, `username`, `role`) sem expor dados sensíveis
- [x] Criar contexto de identidade autenticada no Fastify e política central de acesso `public / authenticated / admin`
- [x] Restringir rotas administrativas existentes, incluindo scan manual, diagnóstico operacional detalhado e importação/sincronização Rekordbox quando aplicável
- [x] Criar APIs administrativas de usuários para listar, criar, alterar papel, ativar/desativar, redefinir senha e revogar sessões
- [x] Impedir desativação/rebaixamento do último administrador ativo e impedir auto-lockout administrativo
- [x] Exigir senha temporária forte ao criar/resetar conta e obrigar troca no primeiro login antes de liberar o uso normal
- [x] Permitir ao usuário autenticado trocar a própria senha e revogar as próprias outras sessões
- [x] Migrar favoritos para ownership por `user_id`, preservando os favoritos atuais no primeiro admin
- [x] Migrar histórico e estatísticas para escopo por `user_id`, preservando o histórico atual no primeiro admin
- [x] Migrar playlists manuais para ownership por `user_id`; manter playlists Rekordbox compartilhadas e somente leitura fora da reimportação
- [x] Migrar `playback_state` de linha global única para uma linha por usuário, preservando fila, posição, volume, shuffle e repeat atuais no primeiro admin
- [x] Revisar todas as queries por ID para aplicar ownership no próprio SQL e evitar IDOR/acesso cruzado entre usuários
- [x] Separar downloads offline e manifesto/cache por `userId`, impedindo vazamento local entre contas no mesmo navegador
- [x] Adaptar o frontend para manter `currentUser` e exibir superfícies conforme `role`, sem usar essa checagem como controle de segurança
- [x] Criar tela administrativa `Usuários`, visível somente para admin, com criação e gerenciamento simples sem cadastro público
- [x] Criar tela `Minha conta` para troca de senha e revogação de sessões próprias
- [x] Remover a dependência permanente de credenciais no `.env` após bootstrap bem-sucedido, mantendo fluxo operacional seguro de recuperação local de administrador
- [x] Documentar bootstrap, criação de usuários, recuperação de acesso, mudança de senha, desativação e rollback de migration
- [x] Adicionar testes unitários de senha, sessão, role, último admin, normalização de username e revogação
- [x] Adicionar testes de integração para `401 / 403 / 404`, ownership, usuário desativado, troca obrigatória de senha e rotas administrativas
- [x] Adicionar Playwright com contas `admin` e `user` em mobile/tablet/desktop, validando menu, login, isolamento de dados e troca de senha
- [x] Adicionar regressões de segurança para tentativa de chamar `/api/admin/*` como `user`, adulteração de payload/role no cliente e acesso a recursos de outro usuário
- [x] Atualizar smoke test de produção para validar migration/bootstrap, login admin e login de usuário normal sem usar o banco real

Critério de conclusão: um `user` pode reproduzir e administrar somente seus dados pessoais, nunca consegue executar operações administrativas mesmo por chamada manual à API, e um `admin` pode gerenciar usuários sem risco de remover o último administrador ou perder os dados existentes no upgrade.

## Fase 8 — Administração da biblioteca

Objetivo: permitir administrar a coleção pelo próprio Home Music, com operações seguras e reversíveis sempre que possível. Toda a área e suas APIs são exclusivas de `admin`, apoiadas na autorização da Fase 7.5.

- [x] Criar área `Administração` separada da experiência de reprodução e protegida por role `admin`
- [x] Criar visão geral com quantidade de faixas, armazenamento, problemas e estado do scanner
- [x] Criar ponto de entrada `Importar mídia` integrado ao pipeline da Fase 9
- [x] Permitir desativar/reativar músicas sem remover o arquivo físico
- [x] Criar lixeira/quarentena com restauração antes da exclusão permanente
- [x] Permitir exclusão física somente após confirmação explícita
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

- [x] Criar modelo de job/fila de importação com estados `pending / processing / completed / failed / cancelled`
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
