# URLs e deep links

O Home Music usa URLs reais para as superfícies navegáveis atuais sem adicionar um router externo. A URL é uma projeção do estado de navegação do frontend; o `AuthenticatedApp` continua montado durante transições internas, preservando o player e o elemento `<audio>`.

## Rotas canônicas

| URL | Superfície |
| --- | --- |
| `/` | Player / Tocando agora |
| `/library` | Biblioteca na visão de Pastas |
| `/library/folders/<caminho>` | Pasta selecionada |
| `/library/playlists` | Lista de Playlists |
| `/library/playlists/<id>` | Playlist selecionada |
| `/account` | Minha conta |
| `/admin` | Administração para usuários `admin` |

Caminhos de pasta são codificados por segmento com `encodeURIComponent`, preservando pontos e espaços que façam parte do nome real. Apenas barras sintéticas nas extremidades do caminho são removidas. IDs de playlist também são codificados antes de entrar na URL.

## Navegação no browser

A integração vive em `apps/web/src/browser-navigation.ts` e usa `history.pushState`, `history.replaceState` e `popstate`.

- navegação feita pela UI cria a URL canônica correspondente;
- Back/Forward restaura a superfície e, quando aplicável, o contexto de pasta ou playlist;
- mudar de tela não remonta `AuthenticatedApp`, portanto o player continua sendo a mesma instância durante navegação interna;
- busca, ordenação e filtros continuam sendo estado transitório da biblioteca e não fazem parte do contrato de deep link atual.

## Refresh direto

O Fastify reconhece explicitamente as rotas canônicas da aplicação antes de usar a extensão do último segmento para decidir o fallback do shell. Isso permite refresh direto de pastas como `AC.DC` ou `Music.v1` sem confundi-las com arquivos estáticos.

O handler mantém assets reservados e caminhos inseguros fora desse fallback. As APIs continuam registradas e protegidas separadamente, portanto uma rota de API inexistente continua sendo erro de API em vez de receber `index.html`.

O service worker já trata requisições de navegação com estratégia network-first e usa o shell cacheado como fallback quando a rede está indisponível. Assim, as rotas acima não exigem uma segunda implementação de routing no service worker.

## Fallbacks

- rota de frontend não reconhecida: o cliente canonicaliza para `/` e abre o Player;
- playlist informada na URL que não existe ou não pertence ao usuário: depois que a lista canônica de playlists termina de carregar, a URL é substituída por `/library/playlists`;
- `/admin` para usuário sem permissão administrativa: o cliente canonicaliza para `/account`;
- autorização real continua no backend: o fallback visual não substitui a política que protege `/api/admin/*`.

## Estatísticas

A issue #112 originalmente mencionava uma rota de Estatísticas. Na revisão de 2026-08-31, o frontend atual não possui uma tela navegável independente de Estatísticas. A implementação não reintroduz uma superfície legada apenas para criar uma URL; caso Estatísticas volte a existir como tela própria, sua rota deve ser adicionada ao contrato acima em uma tarefa específica.

## Testes

`apps/web/src/browser-navigation.test.ts` cobre parse, canonicalização, encoding, nomes de pasta com pontos/espaços e fallback de acesso. `apps/server/src/static-web.test.ts` cobre o fallback de produção para rotas canônicas com segmentos que parecem extensões de arquivo.

O smoke Playwright obrigatório cobre, em mobile, tablet e desktop:

- abertura direta de `/library` antes do login;
- navegação para `/account`;
- Back/Forward do browser;
- preservação do mesmo elemento `<audio>` durante navegação interna;
- entrada e refresh direto em `/admin`;
- canonicalização de playlist inexistente para `/library/playlists`;
- fallback de uma rota de frontend inválida.
