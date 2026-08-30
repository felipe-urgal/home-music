# PWA, cache seletivo e downloads offline

Este documento descreve o comportamento **atual** da PWA do Home Music. Para scheduler, isolamento entre contas e matriz de validação mobile, veja também [offline-downloads.md](offline-downloads.md).

## Registro e atualização

O service worker é registrado no build de produção quando o navegador oferece a API de Service Worker. Em acesso remoto, o cenário recomendado é HTTPS via Tailscale Serve.

`/sw.js` é servido com `Cache-Control: no-store`, permitindo que o navegador verifique atualizações da política do worker. Caches estáticos antigos com prefixo conhecido são removidos durante a ativação quando deixam de ser compatíveis.

## Cache estático

O cache estático é deliberadamente limitado a recursos públicos necessários para montar a aplicação:

- `index.html`;
- assets hashados do Vite em `/assets/*`;
- `manifest.webmanifest`;
- favicon/ícones públicos da aplicação.

Navegações usam estratégia **network-first**. Assets hashados podem usar **cache-first** porque o nome muda junto com o conteúdo.

Conteúdo autenticado de `/api/*` não é colocado no cache estático da PWA. Login, sessão, biblioteca, favoritos, histórico, playlists, capas privadas e streaming continuam protegidos pelo backend.

## Downloads offline atuais

Downloads de áudio são explícitos e usam um cache separado do shell da PWA.

O frontend possui um scheduler global com até **3 operações simultâneas**. Ele é compartilhado entre as superfícies do player e da biblioteca, portanto navegar dentro da SPA não cria uma segunda fila nem cancela jobs em andamento.

O namespace atual é por usuário:

```text
home-music:offline-user-id:v1
home-music:offline-tracks:v2:<userId>
home-music-offline-audio-v2-<userId>
home-music-offline-client-scope-v1
/offline-audio/<trackId>
```

A chave interna do scheduler também inclui `userId + trackId`. Assim, a mesma faixa não é baixada duas vezes simultaneamente para a mesma conta e uma troca de usuário não mistura estado entre identidades.

Uma faixa só é marcada como disponível depois que o arquivo completo foi gravado com sucesso no Cache Storage e o manifesto correspondente foi atualizado.

## Rota virtual de áudio

O service worker atende a rota local:

```text
/offline-audio/<trackId>
```

Ela:

- não é uma rota pública do Fastify;
- lê somente conteúdo já armazenado no cache offline da conta associada ao `clientId`/aba;
- suporta `GET`, `HEAD` e byte ranges necessários ao seek;
- responde `206` para range válido e `416` para range inválido;
- não escolhe usuário por parâmetro de URL.

Sem service worker compatível, a aplicação degrada para offline indisponível em vez de abrir um cache de outra versão/conta.

## Capability e isolamento por client

O protocolo atual do service worker é **versão 3**.

O frontend negocia a capability informando o `userId` autenticado. O worker associa esse usuário ao `clientId` que originou a mensagem e persiste apenas o vínculo mínimo em `home-music-offline-client-scope-v1` para sobreviver à suspensão/reinício do próprio worker.

O worker só considera o client pronto para offline depois que o escopo foi persistido e confirmado. Trocas rápidas de conta são serializadas para que o escopo mais recente vença.

Essa camada evita que duas contas usando o mesmo origin reutilizem downloads uma da outra durante o uso normal da aplicação.

> Cache Storage e `localStorage` pertencem ao perfil do navegador. O isolamento por usuário do Home Music é uma fronteira lógica de produto, não criptografia contra alguém que já controla DevTools/armazenamento local do dispositivo.

## Entrada no modo offline

O Home Music diferencia:

1. **servidor acessível, sessão inválida:** segue para autenticação normal; offline não é bypass de login;
2. **servidor realmente inalcançável:** quando existe um namespace offline conhecido e válido, a interface pode oferecer acesso somente às músicas baixadas daquela conta.

No modo offline não são simulados dados que dependem do servidor, como Administração, rescan, favoritos remotos, histórico ou edição de playlists.

O estado mínimo do player offline usa armazenamento local separado do estado persistido no servidor.

## Armazenamento e quota

Antes de concluir um download, o frontend usa `navigator.storage.estimate()` quando disponível e solicita armazenamento persistente como operação best-effort.

O navegador ainda pode remover dados sob pressão severa de espaço. O Home Music nunca deve anunciar um item como concluído quando o arquivo não está integralmente no cache.

Logout não apaga automaticamente downloads concluídos. A troca de identidade esconde o namespace anterior e negocia um novo escopo com o worker.

## Limite de background

O scheduler vive na execução da página. Navegar dentro da SPA preserva os jobs, mas fechar/recarregar a aba ou o sistema operacional suspender JavaScript pode interromper downloads ainda em andamento.

A garantia real de continuidade com tela bloqueada/background depende da plataforma e ainda precisa de validação em dispositivos reais. A issue [#81](https://github.com/felipe-urgal/home-music/issues/81) mantém esse gate.

## Próximas evoluções

Ainda **não implementado**:

- [#174](https://github.com/felipe-urgal/home-music/issues/174): disponibilizar playlists e pastas completas offline com um único artefato físico por faixa e múltiplas referências lógicas;
- [#176](https://github.com/felipe-urgal/home-music/issues/176): revisar ícone, favicon e identidade visual da PWA em tamanhos reais de launcher.

A #174 deve reutilizar o scheduler/cache atual; não deve criar um segundo pipeline paralelo nem duplicar o arquivo físico quando a mesma faixa pertence a várias coleções offline.
