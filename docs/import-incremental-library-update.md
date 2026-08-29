# Atualização incremental da biblioteca após importação

## Objetivo

Depois que um arquivo de importação é promovido com segurança para `MUSIC_DIR`, o Home Music tenta incorporá-lo à biblioteca imediatamente, sem percorrer novamente todo o filesystem.

## Fluxo principal

1. a promoção cria o arquivo final dentro de `MUSIC_DIR` sem sobrescrever conteúdo existente;
2. o job permanece em `processing`;
3. a atualização da biblioteca entra no mesmo lock usado pelos scans;
4. somente o arquivo recém-promovido é validado e lido pelo indexador;
5. o novo `IndexedTrack` é mesclado ao snapshot atual sem duplicar caminho ou ID;
6. o snapshot é persistido em uma transação SQLite usando a rotina consolidada de `syncTracks`;
7. memória, `scannedAt`, `libraryRevision` e caches afetados são atualizados;
8. somente depois disso o job passa para `completed`.

A leitura incremental usa as mesmas extensões, regras de path safety, fallback de metadata e geração de ID do scanner completo.

## Concorrência

Scans manuais, automáticos e a indexação pós-importação compartilham `LibraryMutationLock`. Isso impede duas escritas simultâneas de snapshot no SQLite e na memória.

Se um scan começar antes da promoção, a importação espera o scan terminar e aplica o arquivo sobre o snapshot resultante. Se o scan já tiver encontrado o arquivo promovido, a etapa incremental reconhece o mesmo caminho/ID e consolida o registro sem criar duplicata.

## Consistência SQLite e memória

O filesystem é lido antes da transação. A persistência SQLite acontece antes da publicação do novo snapshot em memória. Depois do commit, a atualização em memória não executa I/O de filesystem.

A atualização do cache de disponibilidade é tratada separadamente: uma falha nele gera warning, mas não desfaz nem deixa divergentes a lista persistida de faixas e o snapshot em memória.

A revisão da biblioteca é incrementada quando a importação altera o snapshot. O cache de capas é invalidado para evitar servir estado anterior.

## Fallback

Se a indexação incremental não puder ser aplicada — por exemplo porque a raiz mudou, a biblioteca ainda não está pronta ou o arquivo não pode ser reaberto com segurança — o Home Music executa um scan completo dentro do mesmo lock.

Se até o scan completo falhar, o arquivo promovido permanece em `MUSIC_DIR`, o snapshot SQLite/memória anterior é preservado e `libraryReady` passa para `false`. A importação física não é repetida; um scan posterior pode reconciliar o arquivo sem risco de duplicar a mídia.

## Testes

A cobertura inclui:

- indexação de um único arquivo e merge sem duplicidade;
- rejeição de arquivo fora da raiz da biblioteca;
- espera do hook de biblioteca antes de `completed`;
- serialização de mutações e liberação do lock após erro;
- concorrência entre scan e indexação incremental;
- convergência entre `database.loadTracks()` e o snapshot em memória após a importação.
