# Integração opcional com Rekordbox XML

O Home Music pode sincronizar playlists de um **export XML do Rekordbox** sem depender do Rekordbox em runtime, sem acessar conta externa e sem modificar os arquivos de áudio.

## Fluxo

1. No Rekordbox, exporte a coleção/playlists no formato XML `DJ_PLAYLISTS`. O nome exato da opção de exportação pode variar entre versões do Rekordbox.
2. No Home Music, abra **Biblioteca → Playlists**.
3. Toque em **Rekordbox** e selecione o arquivo `.xml`.
4. O Home Music faz um preview com a quantidade de músicas e entradas de playlist reconhecidas.
5. Confirme somente depois de revisar os números mostrados.

O arquivo XML é usado apenas durante o preview/import. O Home Music persiste o resultado no SQLite e não precisa manter o XML disponível depois da sincronização.

## Como as músicas são reconhecidas

O matching é conservador e tenta, nesta ordem:

1. caminho exato do arquivo indicado em `Location`;
2. nome de arquivo único na biblioteca, com duração compatível;
3. artista + título, usando duração e álbum para reduzir ambiguidades.

Quando existem duas ou mais músicas que continuam ambíguas, o Home Music **não escolhe uma por aproximação**. A entrada fica como não reconhecida e é ignorada na playlist importada.

O preview informa:

- músicas existentes no `COLLECTION` do XML;
- quantas foram reconhecidas na biblioteca local;
- playlists encontradas;
- entradas de playlist totais e reconhecidas;
- uma pequena amostra das músicas não reconhecidas.

Se o XML possui entradas de playlist mas nenhuma delas é reconhecida, a sincronização é recusada para evitar substituir playlists por conteúdo vazio devido a um XML de outra biblioteca ou a uma indexação incompleta.

## Pastas e playlists

Pastas do Rekordbox são preservadas no nome para continuar simples dentro do Home Music. Por exemplo:

```text
House
└── Warmup
```

vira:

```text
House / Warmup
```

A ordem das músicas reconhecidas é preservada. Referências repetidas para a mesma faixa não criam duplicatas na playlist do Home Music.

## Reimportação

A sincronização é idempotente e **não destrutiva**:

- a mesma playlist Rekordbox mantém o mesmo registro no Home Music;
- playlists alteradas no XML são atualizadas;
- novas playlists são criadas;
- playlists Rekordbox ausentes no XML atual são mantidas, porque o arquivo pode representar apenas uma exportação parcial;
- playlists manuais do Home Music nunca são alteradas ou removidas pela sincronização.

Playlists marcadas como **Rekordbox** são tratadas como somente leitura para nome e conteúdo. Para alterá-las, faça a mudança no Rekordbox e importe o XML novamente. É permitido excluir uma playlist Rekordbox manualmente do Home Music; uma próxima importação poderá recriá-la caso ela continue no XML.

## Segurança e limites

- todas as rotas da integração exigem sessão autenticada do Home Music;
- preview e importação também exigem o header anti-CSRF das mutações normais;
- o XML é limitado a **20 MiB**;
- o parser aceita somente a estrutura necessária de `DJ_PLAYLISTS`;
- `DOCTYPE` e `ENTITY` são rejeitados;
- nenhuma URL externa do XML é buscada;
- caminhos presentes no XML são usados somente como dados para matching e nunca são abertos diretamente;
- a biblioteca precisa estar pronta antes de preview ou importação.

## Reimportar depois de mover a biblioteca

Se as músicas foram movidas para outro diretório ou vieram de outro computador, o caminho exato pode não bater. O fallback por nome de arquivo e depois por metadados/duração permite reconhecer casos seguros sem exigir que a raiz seja igual à usada pelo Rekordbox.

Se muitas músicas aparecerem como não reconhecidas, primeiro execute uma nova indexação da biblioteca no Home Music e confirme se título, artista e duração foram lidos corretamente antes de sincronizar o XML.
