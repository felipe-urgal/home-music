# Entrega HTTP da biblioteca

Este documento descreve o contrato de performance e segurança do snapshot completo servido por `GET /api/library`, entregue pela issue #235 no PR #248.

## Objetivo

O snapshot completo continua sendo uma API simples e autenticada, mas requisições repetidas não precisam mais:

- reprojetar todas as faixas em cada request;
- serializar novamente o mesmo JSON;
- retransmitir o corpo quando a representação não mudou;
- transferir JSON grande sem compressão quando o cliente suporta Brotli ou gzip.

O fluxo incremental de atualização do frontend permanece separado: `GET /api/library/status` continua pequeno e `private, no-store`, e a revisão continua sendo a sinalização barata de mudança da biblioteca.

## Fluxo de resposta

```text
GET /api/library
   ↓
política central de autenticação
   ↓
LibraryHttpSnapshotCache
   ├── mesma revision → reaproveita projeção pública das faixas
   ├── mesma representação → reaproveita JSON serializado
   └── nova representação → gera ETag novo
   ↓
If-None-Match corresponde?
   ├── sim → 304, sem corpo
   └── não → negocia identity / br / gzip
                ↓
             200 + JSON
```

## Revision e ETag

`libraryRevision` continua sendo a autoridade de mudança do conteúdo público da biblioteca. O cache de projeção é reconstruído quando essa revisão muda.

O ETag não usa apenas o número da revisão. Ele contém:

```text
libraryRevision + hash SHA-256 truncado do corpo serializado
```

O hash adicional evita dois casos de `false 304`:

1. o processo reinicia, a revisão volta ao valor inicial e o conteúdo persistido é diferente do que o navegador tinha em cache;
2. campos de estado presentes na representação, como `scannedAt`/`scanning`, mudam sem que o conjunto de faixas tenha mudado.

O validator é fraco (`W/`) porque Brotli, gzip e identity são codificações diferentes da mesma representação semântica. `If-None-Match` usa comparação fraca apropriada para `GET` e aceita listas de validators e `*`.

## Invalidação

A projeção pública deve receber uma nova `libraryRevision` sempre que algum campo público de uma faixa puder mudar.

Os caminhos atuais cobertos são:

- scan com adição, atualização, remoção ou mudança da raiz;
- importação incremental promovida;
- ativação/desativação administrativa;
- movimentação de arquivo que altera `folder`/`folderPath`;
- atualização de fingerprint/fonte quando o serviço já a classifica como mudança da biblioteca.

A #235 corrigiu explicitamente a movimentação de faixa: antes ela atualizava a projeção pública sem incrementar `libraryRevision`, o que seria incompatível com revalidação HTTP segura.

## Cache privado

`/api/library` usa:

```http
Cache-Control: private, no-cache
ETag: W/"library-r<revision>-<hash>"
Vary: Accept-Encoding
```

`private` impede cache compartilhado de tratar o snapshot autenticado como resposta reutilizável entre usuários. `no-cache` permite armazenamento privado, mas exige revalidação antes de reutilizar a resposta.

A rota continua classificada como `authenticated` pela política central do backend. Não existe bypass de autenticação no caminho de `304`: o hook de autorização roda antes do handler e antes da comparação de `If-None-Match`.

Playlists e outros dados pessoais não foram incluídos nesse cache. Cada API mantém sua política própria.

## Compressão

Corpos com menos de 1 KiB permanecem `identity`, evitando custo de compressão para respostas pequenas.

Acima desse limiar:

- Brotli é preferido quando aceito;
- gzip é usado quando Brotli não é aceito e gzip é;
- `q=0` é respeitado;
- `Vary: Accept-Encoding` impede mistura incorreta entre representações codificadas.

As versões comprimidas são calculadas sob demanda e ficam associadas ao snapshot serializado. Requisições seguintes da mesma representação não recomprimem o JSON.

## Relação com `/api/library/status`

`GET /api/library/status` permanece:

```http
Cache-Control: private, no-store
```

Ele é a fonte barata e atual para `revision`, `scanning` e `scannedAt`. O polling não passa a baixar a biblioteca completa; quando a revisão muda, o frontend pode buscar o snapshot e o validator garante que uma representação antiga nunca seja aceita como atual por engano.

## Testes e medição

A entrega possui regressões dedicadas para:

- ETag estável para representação estável;
- mudança de ETag quando a revisão ou o corpo muda;
- resposta HTTP `304` sem corpo;
- ausência de `false 304` após mudança de revisão;
- negociação Brotli/gzip/identity;
- round-trip exato do JSON comprimido;
- `Cache-Control` privado/revalidável no snapshot;
- `/api/library/status` permanecendo `private, no-store`;
- proteção `authenticated` já coberta pela suíte central de política de acesso.

`npm run benchmark:large-library` também executa `library-http-cache.benchmark.ts` com 10.000 faixas. Ele mede baseline de projeção+serialização, lookup quente do snapshot, custo de `JSON.parse`, bytes raw/gzip/Brotli e explicita que um `304` transfere zero bytes de corpo.

Os números do CI de referência ficam registrados em [large-library-benchmark.md](large-library-benchmark.md), junto dos demais gates de biblioteca grande.
