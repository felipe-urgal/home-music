# Provider externo yt-dlp

A Fase 9 registra `yt-dlp` como primeiro provider externo concreto, mantendo a aquisição fora do core e reutilizando o pipeline comum de staging, validação, duplicatas e promoção.

## Uso

Na Administração → Importar mídia, links de **YouTube Music**, YouTube e outros sites compatíveis devem ser colados em **Fontes externas**. O campo **URL direta** continua reservado a URLs que já apontam para um arquivo de áudio remoto.

O provider é opcional. Se `yt-dlp` não estiver disponível, upload, URL direta e todo o restante do Home Music continuam funcionando normalmente.

Use a importação externa somente para conteúdo que você tenha direito de baixar. O Home Music não adiciona cookies, credenciais nem mecanismos para contornar DRM ou controles de acesso.

## Instalação e configuração

O servidor procura um executável `yt-dlp` nos seguintes caminhos, nesta ordem:

1. `HOME_MUSIC_YT_DLP_PATH`, se configurado;
2. variável legada `HOME_MUSIC_YTDLP_PATH`;
3. `/usr/local/bin/yt-dlp`;
4. `/usr/bin/yt-dlp`;
5. `$HOME/.local/bin/yt-dlp`.

O caminho configurado precisa ser absoluto e executável. Não há launcher de egress separado para configurar.

Exemplo opcional:

```dotenv
HOME_MUSIC_YT_DLP_PATH=/usr/local/bin/yt-dlp
```

Para YouTube/YouTube Music, versões atuais do yt-dlp exigem um runtime JavaScript externo e suporte EJS compatível com a engine instalada. O adapter fornece explicitamente o próprio executável Node que já está executando o Home Music através de `--js-runtimes node:<process.execPath>`, então o deploy não precisa instalar Deno apenas para esse provider.

A distribuição standalone oficial do yt-dlp inclui os componentes EJS necessários. Em instalações baseadas em Python, as dependências padrão/EJS precisam acompanhar a versão do yt-dlp. O Home Music não executa auto-update da engine.

## Fluxo

```text
URL externa
  -> YtDlpProvider
     -> normalização para faixa única quando a URL watch traz contexto de Mix
     -> scratch privado fora de MUSIC_DIR
     -> proxy local de egress com bloqueio SSRF
     -> metadata estruturada do yt-dlp
     -> seleção de uma única fonte audio-only
     -> download do formato escolhido sem reencode
  -> ExternalProviderImportManager
     -> reabre saída como arquivo regular seguro
     -> copia bytes para ImportStagingManager
  -> validação técnica / metadata / duplicatas / promoção
  -> atualização incremental da biblioteca
```

O processo `yt-dlp` nunca recebe `MUSIC_DIR` e não escreve diretamente no staging final.

No fluxo de faixa única, URLs `watch` do YouTube que carregam parâmetros de Mix/playlist (`list`, `index`, `start_radio` e `playnext`) preservam o `v` escolhido e descartam somente o contexto de playlist antes da execução do yt-dlp. Importação de playlists/lotes pertence a um fluxo separado.

## Seleção e preservação de qualidade

O adapter consulta primeiro os formatos disponíveis e usa o seletor compartilhado do pipeline para escolher a melhor fonte de áudio. Ele prefere:

- fonte somente de áudio;
- lossless quando disponível;
- maior qualidade técnica entre candidatos equivalentes.

Depois baixa **exatamente o format ID escolhido**. O provider não usa `--extract-audio`, `--audio-format` nem pós-processamento para uniformizar extensão. A validação e qualquer conversão necessária continuam pertencendo à etapa comum de mídia.

## Metadata e thumbnail

O adapter normaliza `track/title`, `artist/creator`, `album`, `sourceId` e a URL de thumbnail retornada pela engine. Esses valores são apenas sugestões externas.

Título, artista e álbum podem alimentar o preview de metadata depois que a mídia real passa pela validação. A URL de thumbnail não é buscada pelo core fora do isolamento de egress; ela permanece dado não confiável e não autoriza acesso de rede arbitrário.

## Isolamento de egress

Cada execução cria um proxy HTTP local em loopback. O `yt-dlp` recebe esse proxy tanto por argumento explícito quanto pelas variáveis `HTTP_PROXY`, `HTTPS_PROXY` e `ALL_PROXY` de um ambiente reduzido.

O proxy:

- resolve o hostname antes da conexão;
- valida **todos** os IPs retornados antes de abrir qualquer conexão;
- bloqueia loopback, redes privadas, link-local e endpoints de metadata;
- rejeita conjuntos DNS mistos contendo qualquer endereço proibido;
- prefere IPv4 em hosts dual-stack;
- tenta os demais IPs públicos seguros se o primeiro candidato falhar;
- bloqueia hostnames locais (`localhost`, `.local`, `.internal`);
- limita HTTP a porta 80 e CONNECT a 80/443.

O adapter desabilita configuração/plugins do usuário, não herda o ambiente completo do servidor, não usa shell e encerra o grupo de processos em timeout/cancelamento.

## Privacidade e diagnóstico

A URL original é transitória e não é persistida no `ImportJob`. `stderr`, paths internos e mensagens arbitrárias do processo externo não são devolvidos ao navegador.

Falhas conhecidas do yt-dlp são reduzidas a categorias públicas fixas e acionáveis:

- falha de acesso pela rede segura;
- origem exigindo autenticação;
- runtime JavaScript ausente;
- versão incompatível do yt-dlp;
- falha genérica do provider.

O stderr bruto continua privado e nunca é copiado para a fila, preservando URLs assinadas, tokens, paths internos e outros dados transitórios.

## Offline/PWA

Quando o servidor está inalcançável e o dispositivo já possui músicas baixadas, o app entra automaticamente na biblioteca offline uma vez por indisponibilidade. Ao escolher “Tentar conectar”, ele não força a reentrada automática até que a conectividade seja restabelecida.
