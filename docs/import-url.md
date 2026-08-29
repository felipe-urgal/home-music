# Importação por URL

A importação por URL é uma entrada administrativa para baixar um arquivo de áudio remoto sem transformar o Home Music em um proxy HTTP genérico. O download termina no staging de importação e **não grava diretamente em `MUSIC_DIR`**.

## Fluxo

1. `POST /api/admin/imports/urls` recebe uma URL direta e cria um job com `source.type = "url"`.
2. O job passa para `processing` enquanto o servidor resolve e baixa a origem remota.
3. Cada hostname é resolvido antes da conexão. A conexão é feita diretamente no IP já validado, preservando `Host` e SNI para evitar DNS rebinding entre a validação e o socket.
4. O corpo é gravado por streaming em `ImportStagingManager.writePayload(...)`, com limite de bytes aplicado mesmo quando `Content-Length` não existe ou é incorreto.
5. O payload escrito é reaberto de forma segura no staging e inspecionado como áudio com `music-metadata`.
6. Quando o download termina, o job volta para `pending`: o arquivo está no staging e ainda aguarda as próximas etapas de validação/promoção da Fase 9.
7. `DELETE /api/admin/imports/urls/:id` cancela jobs `processing` ou `pending` e remove o workspace de staging.

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

Quando o servidor remoto informa `Content-Type`, o valor precisa ser um tipo de áudio conhecido ou `application/octet-stream`; tipos explicitamente incompatíveis, como `text/html`, são recusados antes da gravação. Se o header estiver ausente, o download pode prosseguir, mas o payload continua sujeito à inspeção obrigatória pelos bytes reais no staging com `music-metadata`.

Essa inspeção é deliberadamente diferente da validação definitiva do pipeline: ela não gera nem consome o token de promoção do staging. A validação profunda/normalização e a promoção para a biblioteca continuam isoladas nas próximas tarefas da Fase 9.

## Estados e mensagens

- `processing`: download/inspeção em andamento;
- `pending`: download concluído e payload mantido no staging;
- `failed`: falha de DNS, SSRF, HTTP remoto, MIME, tamanho, timeout ou arquivo inválido;
- `cancelled`: cancelamento administrativo e limpeza do staging.

Mensagens retornadas ao administrador evitam incluir detalhes internos de rede e nunca repetem a URL completa com query string.

## Testes de abuso

`apps/server/src/import-url.test.ts` cobre:

- IPs privados, loopback, metadata e IPv6 local;
- protocolos, credenciais, portas alternativas e hostname local;
- DNS privado e resolução mista público/privado;
- redirect de origem pública para destino privado;
- `Content-Type` incompatível;
- limite durante streaming sem depender de `Content-Length`;
- timeout;
- cancelamento com limpeza do staging;
- sucesso mantendo `MUSIC_DIR` intacto.

As rotas administrativas também possuem cobertura para RBAC/header de mutação e para o contrato `202 -> processing -> pending`.
