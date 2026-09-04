# Jamendo — descoberta server-side e elegibilidade

Estado desta etapa da #262: **descoberta integrada ao workbench; importação física ainda bloqueada**.

## O que já existe

O servidor registra `JamendoProvider` no `ExternalProviderImportManager` e publica o provider junto dos demais em `GET /api/admin/imports`.

Capabilities atuais:

- `audio: false` — aquisição/download físico ainda não passou pelos gates restantes da #262;
- `metadata: true`;
- `thumbnail: true`;
- `playlists: false`.

A configuração usa somente:

```env
HOME_MUSIC_JAMENDO_CLIENT_ID=seu-client-id
```

O valor fica no servidor. A listagem administrativa expõe apenas `configured: true|false`; o `client_id` não faz parte da resposta pública.

## Busca e workbench

Endpoint administrativo:

```text
GET /api/admin/imports/providers/jamendo/search?q=<texto>&page=<1..500>&limit=<1..50>
```

A tela **Administração → Importar mídia** possui uma origem própria **Descobrir no Jamendo**, separada do formulário de links do YouTube/yt-dlp e das origens locais.

Regras:

- `q` precisa ter pelo menos 2 caracteres e é limitado a 120;
- `page` aceita `1..500`;
- `limit` aceita `1..50`, apesar de a API Jamendo suportar limite maior;
- o servidor consulta somente o endpoint fixo `https://api.jamendo.com/v3.0/tracks/`;
- a resposta externa é limitada a 1 MiB durante a leitura do stream, inclusive sem `Content-Length`;
- timeout padrão: 8 segundos cobre conexão e leitura do corpo;
- CI/testes usam `fetch` injetável e não dependem da internet pública.

A resposta normalizada contém apenas:

- `sourceId`;
- título, artista e álbum;
- duração;
- thumbnail pública;
- URL pública da licença;
- `downloadAllowed` derivado de `audiodownload_allowed`;
- `previewAvailable` como booleano;
- `importAllowed` e motivo de bloqueio calculados pelo servidor;
- atribuição textual baseada em título/artista/Jamendo.

URLs de preview/download retornadas pelo Jamendo e o `client_id` **não** são encaminhados ao browser nesta etapa.

## Política de licença e seleção

A elegibilidade é **fail-closed**. Uma faixa só pode avançar para seleção quando:

1. `audiodownload_allowed` é verdadeiro;
2. existe `license_ccurl` válida;
3. a licença aponta para uma licença Creative Commons reconhecida (`BY`, `BY-SA`, `BY-ND`, `BY-NC`, `BY-NC-SA`, `BY-NC-ND`) ou marca/CC0 de domínio público no host oficial `creativecommons.org`.

Qualquer licença ausente, host/path desconhecido ou permissão de download falsa bloqueia a ação na UI.

A UI não é a autoridade. Ao selecionar uma faixa aparentemente permitida, o browser chama:

```text
POST /api/admin/imports/providers/jamendo/eligibility
X-Home-Music-Request: 1
Content-Type: application/json

{"sourceId":"123"}
```

O servidor consulta novamente a faixa por `sourceId` e responde `409` se a permissão/licença deixou de ser aceitável. Assim, estado antigo no browser ou alteração do DOM não contorna o gate.

## Segurança e próximo gate

Esta entrega ainda não transfere áudio do Jamendo. O `JamendoProvider` continua recusando o caminho genérico de aquisição enquanto faltam os próximos gates da #262:

1. aquisição da mídia permitida para scratch privado;
2. timeout, limite de bytes, Content-Type, redirects/egress e arquivo regular;
3. transferência ao staging comum;
4. FFprobe/metadata/duplicatas/destino/promoção/indexação;
5. persistência/auditoria de origem, licença e atribuição quando aplicável.

Nunca escrever bytes do Jamendo diretamente em `MUSIC_DIR`.

## Cobertura

- unitários do provider cobrem paginação, sanitização, limite streaming, política de licença e revalidação por `sourceId`;
- rotas cobrem Jamendo não configurado, elegibilidade permitida e bloqueio `409`;
- Playwright crítico usa respostas fake para verificar busca, artista/álbum/duração, licença, disponibilidade de download, botão bloqueado e header anti-CSRF da revalidação;
- CI não consulta a internet pública para validar a integração.
