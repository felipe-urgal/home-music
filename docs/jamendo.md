# Jamendo — descoberta server-side

Estado desta etapa da #262: **descoberta habilitada; importação física ainda bloqueada**.

## O que já existe

O servidor registra `JamendoProvider` no `ExternalProviderImportManager` e publica o provider junto dos demais em `GET /api/admin/imports`.

Capabilities atuais:

- `audio: false` — download/importação física ainda não passou pelos gates restantes da #262;
- `metadata: true`;
- `thumbnail: true`;
- `playlists: false`.

A configuração usa somente:

```env
HOME_MUSIC_JAMENDO_CLIENT_ID=seu-client-id
```

O valor fica no servidor. A listagem administrativa expõe apenas `configured: true|false`; o `client_id` não faz parte da resposta pública.

## Busca

Endpoint administrativo:

```text
GET /api/admin/imports/providers/jamendo/search?q=<texto>&page=<1..500>&limit=<1..50>
```

Regras:

- `q` precisa ter pelo menos 2 caracteres e é limitado a 120;
- `page` aceita `1..500`;
- `limit` aceita `1..50`, apesar de a API Jamendo suportar limite maior;
- o servidor consulta somente o endpoint fixo `https://api.jamendo.com/v3.0/tracks/`;
- a resposta externa é limitada a 1 MiB;
- timeout padrão: 8 segundos;
- CI/testes usam `fetch` injetável e não dependem da internet pública.

A resposta normalizada contém apenas:

- `sourceId`;
- título, artista e álbum;
- duração;
- thumbnail pública;
- URL pública da licença;
- `downloadAllowed` derivado de `audiodownload_allowed`;
- `previewAvailable` como booleano.

URLs de preview/download retornadas pelo Jamendo e o `client_id` **não** são encaminhados ao browser nesta etapa.

## Segurança e próximo gate

Esta entrega não habilita importação física. O `JamendoProvider` recusa o caminho genérico de importação enquanto ainda faltam os gates da #262:

1. seleção explícita no workbench;
2. exibição de licença/atribuição antes da confirmação;
3. bloqueio efetivo quando `audiodownload_allowed`/licença não permitir;
4. aquisição para scratch privado com timeout, limite de bytes, redirects/egress e validação;
5. transferência ao staging comum e pipeline de metadata/duplicatas/promoção/indexação.

Nunca escrever bytes do Jamendo diretamente em `MUSIC_DIR`.
