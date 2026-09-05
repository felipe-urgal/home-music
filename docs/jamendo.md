# Jamendo — descoberta e importação segura

Estado da #262: **P0 tecnicamente concluído no PR #276**, incluindo descoberta, elegibilidade, aquisição física `scratch → staging`, cenários negativos e CI sem dependência de internet pública.

## Configuração e capability

O servidor registra `JamendoProvider` no `ExternalProviderImportManager` e publica o provider junto dos demais em `GET /api/admin/imports`.

Capabilities atuais:

- `audio: true` — faixa elegível pode ser adquirida para o scratch privado e transferida ao staging comum;
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

A tela **Administração → Importar mídia** possui a origem **Descobrir no Jamendo**, separada do formulário de links do YouTube/yt-dlp e das origens locais.

Regras de descoberta:

- `q` precisa ter pelo menos 2 caracteres e é limitado a 120;
- `page` aceita `1..500`;
- `limit` aceita `1..50`, apesar de a API Jamendo suportar limite maior;
- o servidor consulta somente o endpoint fixo `https://api.jamendo.com/v3.0/tracks/`;
- a resposta externa é limitada a 1 MiB durante a leitura do stream, inclusive sem `Content-Length`;
- timeout padrão da consulta de descoberta: 8 segundos;
- CI/testes usam dependências injetáveis e não dependem da internet pública.

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

URLs de preview/download retornadas pelo Jamendo e o `client_id` **não** são encaminhados ao browser. A URL de licença pode ser mantida para diagnóstico, mas a UI só a transforma em link quando ela aponta para uma licença Creative Commons reconhecida no host oficial; URL externa não reconhecida é mostrada apenas como estado bloqueado, sem navegação clicável.

## Política de licença e confirmação

A elegibilidade é **fail-closed**. Uma faixa só pode avançar quando:

1. `audiodownload_allowed` é verdadeiro;
2. existe `license_ccurl` válida;
3. a licença aponta para uma licença Creative Commons reconhecida (`BY`, `BY-SA`, `BY-ND`, `BY-NC`, `BY-NC-SA`, `BY-NC-ND`) ou marca/CC0 de domínio público no host oficial `creativecommons.org`;
4. a API ainda retorna uma URL de download utilizável no momento da revalidação.

Qualquer licença ausente, host/path desconhecido, permissão de download falsa ou ausência da URL física bloqueia a importação.

A UI não é a autoridade. Antes de iniciar o job, o browser chama:

```text
POST /api/admin/imports/providers/jamendo/eligibility
X-Home-Music-Request: 1
Content-Type: application/json

{"sourceId":"123"}
```

O servidor consulta novamente a faixa por `sourceId`. A atribuição e a licença permanecem visíveis no card antes do botão **Importar**. Se o estado continuar permitido, o browser inicia a importação usando somente a URL pública canônica da faixa:

```text
POST /api/admin/imports/providers/jamendo
X-Home-Music-Request: 1
Content-Type: application/json

{
  "url": "https://www.jamendo.com/track/123",
  "automatic": true
}
```

A URL assinada de `audiodownload` nunca volta ao browser e não é usada como identificador persistente do job.

## Aquisição física no scratch

O `JamendoProvider` aceita somente URLs canônicas HTTPS de faixa em `jamendo.com`/`www.jamendo.com`, sem query string, fragmento, porta alternativa ou credenciais.

Ao preparar a mídia, o provider:

1. extrai apenas o `sourceId` da URL pública;
2. consulta novamente a API Jamendo;
3. reaplica a política de download/licença;
4. mantém `audiodownload` apenas como dado transitório server-side;
5. executa a transferência dentro do scratch privado do provider.

Para evitar uma segunda implementação de política de rede, a transferência física reutiliza o `ImportUrlManager` dentro de um staging temporário contido no próprio scratch. Isso herda as proteções já existentes de importação por URL:

- HTTP/HTTPS e portas padrão apenas;
- bloqueio de localhost/redes privadas, reservadas e especiais;
- resolução DNS e conexão pinada ao endereço público validado;
- revalidação da política a cada redirect;
- limite de redirects;
- allowlist de `Content-Type` de áudio;
- limite de bytes por `Content-Length` e durante o stream;
- timeout global;
- rejeição de arquivo vazio;
- leitura por `music-metadata` antes de aceitar o payload como áudio.

Esse staging interno é apenas um mecanismo de download seguro dentro do scratch; ele **não** promove nada para a biblioteca.

## Transferência ao pipeline comum

Depois que a aquisição termina, o `ExternalProviderImportManager` continua como fronteira de confiança:

1. reabre a saída dentro do scratch com as proteções contra traversal/symlink;
2. exige arquivo regular e não vazio;
3. aplica novamente o limite de bytes durante a cópia;
4. detecta mudança de tamanho/mtime durante a transferência;
5. grava os bytes no `ImportStagingManager` real;
6. limpa o scratch;
7. muda o job para `pending`.

Com `automatic: true`, o fluxo existente continua pelas mesmas etapas de qualquer outra importação:

```text
Jamendo elegível
  → scratch privado
  → ImportStagingManager
  → FFprobe/FFmpeg
  → metadata
  → duplicatas
  → destino seguro
  → promoção
  → indexação incremental
```

Nunca há escrita direta do Jamendo em `MUSIC_DIR`.

## Origem, licença e atribuição

A metadata administrativa de descoberta/elegibilidade preserva os dados auditáveis que são seguros para exibição:

- `sourceId` do Jamendo;
- URL pública da licença;
- atribuição textual;
- título/artista/álbum/thumbnail normalizados.

A origem utilizada para iniciar a importação é a URL pública canônica `https://www.jamendo.com/track/<sourceId>`. A URL assinada de download é deliberadamente transitória: não é devolvida à UI, não aparece no estado público do provider e os testes garantem que o resultado preparado não a ecoa.

## Cobertura e hardening final

Além do happy path existente, o PR #276 cobre explicitamente:

- `429`/rate limit sem retry oculto;
- resposta malformada da API;
- redirect inesperado/inseguro;
- item parcialmente inválido sem derrubar resultados válidos da mesma página;
- faixa removida entre descoberta e importação;
- payload que não é arquivo regular;
- cleanup de scratch/staging em falhas;
- fake provider/downloader local, sem internet pública no CI.

A suíte funcional também preserva as regressões já existentes de licença, elegibilidade, aquisição física e ausência de URL assinada nas respostas públicas.

## Gate de fechamento

O P0 só é considerado concluído quando o head final mantém typecheck, testes e build verdes, sem regressão de SSRF/egress, confinement, cleanup ou exposição de segredo. O PR #276 executa esse fechamento junto com a documentação da Fase 13.
