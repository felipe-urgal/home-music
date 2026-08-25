# PWA e cache seletivo

O Home Music registra um service worker somente no build de produção e apenas quando o navegador oferece a API de Service Worker. Em uso remoto, isso acontece normalmente no acesso HTTPS via Tailscale Serve.

## O que entra no cache

O cache da PWA é deliberadamente restrito a recursos públicos e estáticos:

- `index.html` usado como shell da aplicação;
- assets hashados gerados pelo Vite em `/assets/*`;
- `manifest.webmanifest`;
- `favicon.svg`.

Na instalação, o service worker busca o shell, identifica os assets Vite referenciados pelo HTML e aquece o cache para que uma próxima abertura consiga carregar a interface mesmo sem rede.

Navegações usam estratégia **network-first**: quando o servidor está acessível, o HTML mais novo vence e atualiza o shell armazenado. Assets hashados usam **cache-first**, pois seus nomes mudam quando o conteúdo muda. Manifesto e favicon usam cache com revalidação em background.

## O que nunca entra neste cache

Nenhuma URL da árvore `/api` é interceptada pelo cache estático. Isso inclui:

- autenticação e sessão;
- biblioteca e status;
- favoritos, histórico e playlists;
- estado do player;
- capas em `/api/tracks/:id/cover`;
- áudio em `/api/tracks/:id/stream`.

Essa separação é intencional para não manter conteúdo autenticado disponível depois de logout ou expiração de sessão.

## Limite atual do modo offline

Este estágio entrega o **shell offline da PWA**, não reprodução offline de músicas. Sem conexão com o Ubuntu/Tailscale, a interface pode abrir a partir do cache, mas dados privados e áudio continuam dependendo do backend.

O próximo estágio do roadmap é **Download offline**, que deve ter armazenamento e ciclo de vida próprios para faixas escolhidas pelo usuário, sem reutilizar o cache estático da aplicação.

## Atualizações

O arquivo `/sw.js` é servido com `Cache-Control: no-store`, permitindo que o navegador verifique mudanças na política do service worker. Caches estáticos antigos com prefixo `home-music-static-` são removidos quando uma nova versão do service worker é ativada.
