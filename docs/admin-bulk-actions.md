# Ações administrativas em lote

Esta entrega adiciona seleção múltipla e orquestração em lote às superfícies `Gerenciar músicas` e `Lixeira`, sem criar APIs administrativas paralelas nem operações diretas de filesystem no frontend.

## Princípios

- cada ação em lote reutiliza a mesma primitiva unitária já autorizada e testada;
- o frontend limita a quantidade de requests concorrentes e mantém resultado por item;
- uma falha não cancela nem desfaz itens independentes já concluídos;
- após resultado parcial, somente os itens com falha permanecem selecionados para retry;
- autorização continua exclusivamente no backend; seleção no cliente nunca concede permissão;
- ações pessoais usam a identidade da sessão atual, sem aceitar `userId` arbitrário;
- playlists Rekordbox permanecem somente leitura.

## Operações disponíveis

Em `Gerenciar músicas`:

- reativar faixas desativadas;
- desativar faixas ativas;
- favoritar faixas ativas para o usuário atual;
- adicionar faixas ativas a uma playlist manual do usuário atual;
- mover faixas para a lixeira/quarentena reversível.

Em `Lixeira`:

- restaurar múltiplas faixas;
- excluir múltiplas faixas permanentemente.

A exclusão permanente em lote exige que o administrador digite `EXCLUIR PERMANENTEMENTE`. Os deletes físicos são executados individualmente e a biblioteca faz um único rescan ao final dos deletes concluídos.

## Concorrência e filesystem

O helper `runAdminBatch()` limita concorrência no cliente e reporta progresso e falhas por item. Operações de mídia destrutivas continuam passando por `MediaQuarantineStore`, cujo `withMediaQuarantineLock()` serializa `quarantine`, `restore` e `deletePermanently` no servidor.

Portanto:

- o lote não implementa `rename`, `unlink`, path validation ou rollback;
- o frontend não cria uma segunda fila de filesystem;
- confinement, colisões, symlinks e rollback continuam responsabilidade da infraestrutura de quarentena existente.

## Playlists e consistência de estado

A Administração carrega uma snapshot das playlists manuais apenas para a escolha da ação. Depois de uma mutação, publica `PLAYLISTS_CHANGED_EVENT`; a instância canônica de `useLibraryData()` refaz `/api/playlists`. Assim, ao voltar à biblioteca, o estado principal já está sincronizado sem criar um segundo store persistente.

## Limite de escopo: mover arquivos

Mover/organizar arquivos dentro de `MUSIC_DIR` permanece na issue #88. Essa operação exige serviço próprio com validação de destino, confinement, tratamento de colisões e rollback. A #85 não implementa `rename` arbitrário para satisfazer o item de forma insegura.

Quando #88 fornecer essa primitiva segura, ela poderá ser conectada ao mesmo modelo de seleção/orquestração em lote desta entrega.
