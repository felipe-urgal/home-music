# PWA, cache seletivo e downloads offline

O Home Music registra um service worker somente no build de produção e apenas quando o navegador oferece a API de Service Worker. Em uso remoto, isso acontece normalmente no acesso HTTPS via Tailscale Serve.

## Cache estático

O cache estático da PWA é deliberadamente restrito a recursos públicos:

- `index.html` usado como shell da aplicação;
- assets hashados gerados pelo Vite em `/assets/*`;
- `manifest.webmanifest`;
- `favicon.svg`.

Na instalação, o service worker busca o shell, identifica os assets Vite referenciados pelo HTML e aquece o cache para que uma próxima abertura consiga carregar a interface mesmo sem rede.

Navegações usam estratégia **network-first**: quando o servidor está acessível, o HTML mais novo vence e atualiza o shell armazenado. Assets hashados usam **cache-first**, pois seus nomes mudam quando o conteúdo muda. Manifesto e favicon usam cache com revalidação em background.

Nenhuma URL da árvore `/api` entra automaticamente nesse cache. Login, sessão, biblioteca, favoritos, histórico, playlists, capas e streaming continuam sendo recursos privados dependentes do backend.

## Downloads offline

Uma faixa só é armazenada localmente depois de uma ação explícita do usuário no player. O botão de download busca o arquivo completo através da rota autenticada normal `/api/tracks/:id/stream` e salva a resposta em um cache separado chamado `home-music-offline-audio-v1`.

Os metadados mínimos necessários para listar os downloads ficam em armazenamento local do navegador. O Home Music reconcilia esse manifesto com o Cache Storage na inicialização; se o navegador tiver removido um arquivo por pressão de espaço, o item deixa de ser anunciado como disponível offline.

O service worker expõe uma rota **virtual e local** `/offline-audio/:id`. Essa rota:

- nunca é servida pelo Fastify; sem service worker ela retorna `404`;
- lê somente arquivos já existentes no cache de downloads;
- suporta `GET`, `HEAD` e um único byte range;
- responde `206` para seek/ranges válidos e `416` para ranges inválidos;
- não depende da sessão ou do servidor depois que o download foi concluído.

Isso permite que o mesmo `<audio>` use seek, fila, shuffle, repeat e Media Session no modo offline sem criar uma rota pública alternativa no backend.

## Entrada no modo offline

O Home Music diferencia dois cenários:

1. **Servidor respondeu, mas a sessão não é válida:** o usuário continua na autenticação normal e os downloads não servem como bypass do login.
2. **Servidor realmente inalcançável:** se existirem músicas baixadas, a tela de entrada oferece **Abrir downloads offline**.

No modo offline ficam disponíveis apenas as músicas explicitamente baixadas. Favoritos, playlists, histórico, rescan e demais dados do servidor não são simulados localmente.

O estado básico do player offline (faixa, posição, volume, fila, shuffle e repeat) usa uma chave local separada e nunca é enviado ao servidor enquanto o modo offline está ativo.

## Privacidade e ciclo de vida

Downloads são cópias locais intencionais. Eles permanecem no dispositivo até serem removidos pelo usuário ou até o navegador limpar o armazenamento do site. Fazer logout não apaga automaticamente os arquivos, da mesma forma que um arquivo baixado para um dispositivo não deixa de existir ao encerrar uma sessão.

O app solicita armazenamento persistente quando a API do navegador permite, mas isso é **best-effort**. Sistemas móveis ainda podem remover dados do site sob pressão severa de espaço. Antes de salvar um arquivo, o Home Music consulta a estimativa de quota quando disponível e apresenta erro amigável em caso de falta de espaço.

## Atualizações

O arquivo `/sw.js` é servido com `Cache-Control: no-store`, permitindo que o navegador verifique mudanças na política do service worker. Caches estáticos antigos com prefixo `home-music-static-` são removidos quando uma nova versão é ativada. O cache de áudio offline usa outro prefixo e não é apagado durante uma atualização normal da aplicação.
