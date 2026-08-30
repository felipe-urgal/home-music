# Importação por URL

A importação por URL é uma entrada administrativa para baixar um arquivo de áudio remoto sem transformar o Home Music em um proxy HTTP genérico. O download termina no staging de importação e **não grava diretamente em `MUSIC_DIR`**.

## Fluxo atual

1. `POST /api/admin/imports/urls` recebe uma URL direta e cria um job com `source.type = "url"`.
2. O job passa para `processing` enquanto o servidor resolve e baixa a origem remota.
3. Cada hostname é resolvido antes da conexão. A conexão é feita diretamente no IP já validado, preservando `Host` e SNI para reduzir risco de DNS rebinding entre a validação e o socket.
4. O corpo é gravado por streaming no staging, com limite de bytes aplicado mesmo quando `Content-Length` não existe ou é incorreto.
5. O payload escrito é reaberto de forma segura e recebe uma inspeção inicial pelos bytes reais.
6. Quando a aquisição termina, o job fica disponível para a etapa **Preparar** do workbench.
7. A partir daí ele usa o pipeline comum: validação técnica → metadata → duplicatas → destino seguro → promoção → indexação incremental.
8. Cancelamento de job ainda não promovido remove o workspace temporário correspondente.

## Proteções SSRF

O downloader usa uma política `fail closed`:

- aceita somente `http:` e `https:`;
- recusa credenciais embutidas na URL;
- aceita somente as portas padrão 80/443;
- recusa `localhost`, `.localhost`, `.local` e `.internal`;
- resolve todos os endereços retornados pelo DNS e recusa o hostname inteiro se **qualquer** endereço estiver em uma faixa bloqueada;
- bloqueia loopback, redes privadas, CGNAT, link-local, multicast, faixas de documentação/teste e IPv6 ULA/link-local;
- IPv4-mapped IPv6 também passa pela classificação de IPv4;
- cada redirect é parseado, resolvido e validado novamente antes da próxima conexão;
- a conexão usa o IP já validado em vez de fazer uma nova resolução implícita;
- não encaminha cookies, Authorization ou headers do navegador para o servidor remoto;
- não persiste query string no label do job, evitando expor tokens de URLs assinadas na fila administrativa.

Isso inclui o bloqueio de endpoints de metadata baseados em link-local, como `169.254.169.254`.

## Limites

Variáveis de ambiente:

- `HOME_MUSIC_IMPORT_URL_MAX_MB`: tamanho máximo do download. Padrão `512`, intervalo `1..8192` MB.
- `HOME_MUSIC_IMPORT_URL_TIMEOUT_SECONDS`: timeout do download. Padrão `120`, intervalo `5..900` segundos.
- `HOME_MUSIC_IMPORT_URL_MAX_REDIRECTS`: máximo de redirects. Padrão `3`, intervalo `0..10`.

O servidor valida `Content-Length` quando disponível e mantém um contador independente durante o streaming. Assim, resposta chunked ou servidor que informa tamanho incorreto não contorna o limite.

## Content-Type e arquivo final

Quando o servidor remoto informa `Content-Type`, o valor precisa ser um tipo de áudio conhecido ou `application/octet-stream`; tipos explicitamente incompatíveis, como `text/html`, são recusados antes da gravação. Se o header estiver ausente, o download pode prosseguir, mas o payload continua sujeito à inspeção obrigatória pelos bytes reais no staging.

Essa inspeção inicial não substitui a validação técnica do pipeline. O token usado pela promoção só é produzido depois que a etapa **Preparar** confirma a mídia e o resultado técnico esperado.

## Estados e mensagens

- `processing`: aquisição/inspeção em andamento;
- `pending`: aquisição concluída e payload mantido no staging aguardando próxima ação do pipeline;
- `failed`: falha de DNS, SSRF, HTTP remoto, MIME, tamanho, timeout ou arquivo inválido;
- `cancelled`: cancelamento administrativo e limpeza do staging quando aplicável;
- `completed`: somente depois de promoção e atualização da biblioteca concluídas.

Mensagens retornadas ao administrador evitam incluir detalhes internos de rede e nunca repetem a URL completa com query string.

## UX atual

A URL direta fica na etapa **Origem** do workbench de importação. Ela deve ser usada quando a URL já aponta para um arquivo de mídia; YouTube/YouTube Music e outras fontes tratadas por engine externa pertencem ao provider correspondente.

Depois da aquisição, o painel **Agora** mostra a próxima ação necessária sem exigir que o administrador abra detalhes técnicos para descobrir como continuar.

## Testes de abuso

`apps/server/src/import-url.test.ts` cobre, entre outros:

- IPs privados, loopback, metadata e IPv6 local;
- protocolos, credenciais, portas alternativas e hostname local;
- DNS privado e resolução mista público/privado;
- redirect de origem pública para destino privado;
- `Content-Type` incompatível;
- limite durante streaming sem depender de `Content-Length`;
- timeout;
- cancelamento com limpeza do staging;
- sucesso mantendo `MUSIC_DIR` intacto até a promoção segura.

As rotas administrativas também possuem cobertura para RBAC/header de mutação e para as transições esperadas do job.
