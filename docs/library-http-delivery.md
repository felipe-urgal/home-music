# Entrega HTTP da biblioteca

Este documento descreve o contrato de performance e segurança do snapshot completo servido por `GET /api/library`, introduzido pela issue #235 no PR #248 e corrigido pela #251 para preservar a projeção efetiva de metadados antes do cache HTTP.

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
projeção efetiva da biblioteca
   ├── metadata física
   ├── override SQLite por faixa
   ├── normalização lógica de artista/álbum
   └── override de capa
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

A ordem importa. A projeção lógica precisa acontecer **antes** de o cache serializar a resposta como `Buffer`. Fazer a transformação somente em `preSerialization` deixaria de atuar sobre o snapshot já pré-serializado e poderia publicar metadata física mesmo quando um override estivesse ativo.

## Revision e ETag

A revisão publicada pela rota é uma revisão **composta** da representação pública. Ela combina a `libraryRevision` do snapshot físico com a revisão administrativa das camadas que também podem alterar campos visíveis, hoje metadata por faixa, normalização, capa e movimentação administrativa.

Na composição atual:

```text
revision efetiva = libraryRevision + revisão administrativa composta
```

A soma é detalhe de implementação; a invariante importante é que qualquer mudança pública relevante produza uma revisão diferente sem exigir scan.

O ETag não usa apenas o número da revisão. Ele contém:

```text
revision efetiva + hash SHA-256 truncado do corpo serializado
```

O hash adicional evita casos de `false 304`, incluindo:

1. o processo reinicia, a revisão volta ao valor inicial e o conteúdo persistido é diferente do que o navegador tinha em cache;
2. campos de estado presentes na representação, como `scannedAt`/`scanning`, mudam sem que o conjunto de faixas tenha mudado;
3. uma representação persistida por override/normalização difere apesar de uma revisão numérica coincidente após restart.

O validator é fraco (`W/`) porque Brotli, gzip e identity são codificações diferentes da mesma representação semântica. `If-None-Match` usa comparação fraca apropriada para `GET` e aceita listas de validators e `*`.

## Invalidação

A projeção pública deve receber uma nova revisão sempre que algum campo público de uma faixa puder mudar.

Os caminhos atuais cobertos são:

- scan com adição, atualização, remoção ou mudança da raiz;
- importação incremental promovida;
- ativação/desativação administrativa;
- movimentação de arquivo que altera `folder`/`folderPath`;
- atualização de fingerprint/fonte quando o serviço já a classifica como mudança da biblioteca;
- salvar ou restaurar override textual de metadata;
- salvar ou restaurar override de capa;
- criar, alterar ou remover normalização lógica relevante.

A #235 corrigiu explicitamente a movimentação de faixa: antes ela atualizava a projeção pública sem incrementar `libraryRevision`, o que seria incompatível com revalidação HTTP segura. A #251 estendeu a mesma invariante às camadas administrativas e moveu sua projeção para antes do snapshot/cache.

`GET /api/library/status` publica a mesma revisão efetiva usada pelo snapshot. Assim, o polling barato do frontend detecta alterações administrativas e pode buscar `/api/library` sem rescan.

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

Alterações administrativas também publicam `home-music:library-changed` no frontend após a confirmação da mutação, permitindo atualização imediata da sessão que realizou a edição. A revisão efetiva cobre a reconciliação posterior por polling e outras superfícies que dependem do mesmo snapshot.

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
- autenticação antes do caminho condicional de `304`;
- refresh após scan no Playwright com revalidação do snapshot;
- caminho real de metadata override → projeção efetiva → snapshot serializado, provando novo ETag/revision, `304` do estado atual e restauração sem mutar o objeto físico;
- Playwright desktop provando que a mesma alteração atualiza o player persistente e a saúde administrativa sem rescan.

`npm run benchmark:large-library` também executa `library-http-cache.benchmark.ts` com 10.000 faixas. Ele mede baseline de projeção+serialização, lookup quente do snapshot, custo de `JSON.parse`, bytes raw/gzip/Brotli e explicita que um `304` transfere zero bytes de corpo.

### Baseline de referência da #235

Execução local de referência em 2026-09-02, usando o mesmo dataset sintético e os mesmos parâmetros de compressão do benchmark versionado:

| Medição | Resultado de referência |
| --- | ---: |
| projeção + serialização do snapshot de 10k | ~32,3 ms |
| lookup quente do snapshot | ~0,0007 ms |
| projeções públicas no caminho quente | 1 |
| `JSON.parse` do snapshot de 10k | ~17,8 ms |
| payload bruto | 2.036.554 bytes (~1,94 MiB) |
| gzip nível 6 | 176.786 bytes (~91,3% menor) |
| Brotli quality 4 | 117.452 bytes (~94,2% menor) |
| `304 Not Modified` | 0 bytes de corpo |

Os tempos absolutos dependem da máquina e servem como evidência direcional, não como SLA. Os tamanhos do payload são determinísticos para o dataset versionado. O gate completo do PR #248 também executa o benchmark rápido, o cenário Chromium real e os E2E críticos no head final.

Para guardrails gerais de biblioteca grande e interpretação entre runners, consulte [large-library-benchmark.md](large-library-benchmark.md).