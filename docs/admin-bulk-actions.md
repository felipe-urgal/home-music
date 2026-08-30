# Ações administrativas em lote

As superfícies **Gerenciar músicas** e **Lixeira** reutilizam primitivas unitárias já autorizadas pelo backend para executar operações sobre múltiplos itens, sem criar APIs paralelas nem implementar filesystem destrutivo no frontend.

## Princípios

- cada ação em lote reutiliza a mesma operação unitária já testada;
- o frontend limita concorrência e mantém resultado por item;
- uma falha não cancela nem desfaz itens independentes concluídos;
- após resultado parcial, somente falhas permanecem selecionadas para retry quando aplicável;
- autorização continua no backend;
- ações pessoais usam a identidade da sessão, sem `userId` arbitrário;
- playlists Rekordbox permanecem somente leitura;
- ações destrutivas ficam visualmente separadas das ações reversíveis.

## Gerenciar músicas

Operações atuais incluem:

- reativar faixas desativadas;
- desativar faixas ativas;
- favoritar faixas ativas para o usuário atual;
- adicionar faixas ativas a playlist manual do usuário atual;
- mover múltiplas faixas para a lixeira/quarentena reversível.

Após o redesign do PR #173, a barra de lote aparece somente quando existe seleção. A lista principal não precisa exibir todas as operações o tempo todo.

Mover/organizar um arquivo físico individualmente usa a infraestrutura segura concluída na #88. O frontend não faz `rename` arbitrário.

## Lixeira

Operações em lote:

- restaurar múltiplas faixas;
- excluir múltiplas faixas permanentemente.

A exclusão permanente em lote exige digitar exatamente:

```text
EXCLUIR PERMANENTEMENTE
```

Os deletes são executados item a item e a biblioteca realiza o cleanup/refresh necessário ao final das exclusões concluídas.

No redesign do PR #181:

- a toolbar só aparece quando há seleção;
- mudar o texto de busca limpa seleção e inspetor, evitando manter itens ocultos selecionados para uma ação destrutiva;
- ações individuais de restaurar/excluir ficam no inspetor lateral, não expostas em cada linha;
- exclusão permanente continua isolada em zona de perigo.

## Concorrência e filesystem

`runAdminBatch()` limita concorrência no cliente e reporta progresso/falhas.

Operações físicas continuam em serviços/infraestrutura do servidor. O lote não implementa diretamente:

- `rename`;
- `unlink`;
- path validation;
- confinement;
- tratamento de symlink;
- rollback de filesystem.

Essas invariantes permanecem nas primitivas de quarentena/movimentação.

## Movimentação física

A #88 já entregou movimentação segura dentro de `MUSIC_DIR`, com validação de origem/destino, no-clobber, confinement e rollback quando possível.

O modelo de lote pode reutilizar essa primitiva no futuro caso seja criada uma UX segura para escolher destino comum de múltiplas faixas; não é correto implementar um segundo caminho de filesystem no cliente.

## Playlists e consistência

A Administração carrega playlists manuais para a escolha da ação. Depois da mutação, publica o evento de mudança para que a fonte canônica de dados refaça `/api/playlists`.

Isso evita criar um segundo store persistente de playlists dentro da Administração.

## Segurança destrutiva

- enviar para lixeira é preferível a apagar diretamente;
- restauração é reversível;
- exclusão permanente individual exige confirmação explícita;
- exclusão em lote exige confirmação digitada;
- filtro/busca não pode manter seleção destrutiva invisível;
- falha parcial deve permanecer visível e recuperável.
