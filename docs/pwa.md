# PWA, cache seletivo e downloads offline

Este documento descreve o comportamento **atual** da PWA do Home Music. Para scheduler, referências lógicas, deduplicação, sincronização e matriz de validação mobile, veja também [offline-downloads.md](offline-downloads.md).

## Registro e atualização

O service worker é registrado no build de produção quando o navegador oferece a API de Service Worker. Em acesso remoto, o cenário recomendado é HTTPS via Tailscale Serve.

`/sw.js` é servido com `Cache-Control: no-store`, permitindo que o navegador verifique atualizações da política do worker. Caches estáticos antigos com prefixo conhecido são removidos durante a ativação quando deixam de ser compatíveis.

## Identidade de instalação

A #176 substituiu o placeholder genérico por uma identidade **Casa + vinil**, sem texto dentro do ícone e alinhada ao fundo escuro + azul atual.

O manifest usa PNGs `192x192` e `512x512` em variantes `any` e `maskable`. O shell HTML também expõe `apple-touch-icon` `180x180`, favicon SVG e pinned tab monocromático do Safari.

Os PNGs são gerados deterministicamente por `apps/web/scripts/generate-pwa-icons.mjs` antes de desenvolvimento, build e testes. A fonte visual, safe zone e matriz de assets estão documentadas em [pwa-icon-identity.md](pwa-icon-identity.md).

Essa evolução não altera o namespace de áudio offline.

## Cache estático

O cache estático é deliberadamente limitado a recursos públicos necessários para montar a aplicação:

- `index.html`;
- assets hashados do Vite em `/assets/*`;
- `manifest.webmanifest`;
- favicon/ícones públicos da aplicação.

Navegações usam estratégia **network-first**. Assets hashados podem usar **cache-first** porque o nome muda junto com o conteúdo.

Conteúdo autenticado de `/api/*` não é colocado no cache estático da PWA. Login, sessão, biblioteca, favoritos, histórico, playlists, capas privadas e streaming continuam protegidos pelo backend.

## Downloads offline

Áudio offline é explícito e usa armazenamento separado do app shell.

O frontend possui um scheduler global com até **3 operações simultâneas**. Ele é compartilhado por download individual, lote desktop, playlists e pastas. Navegar na SPA não cria uma segunda fila.

Em navegadores que expõem **Background Fetch** e estão sob o service worker capability v4, a transferência da faixa é delegada ao navegador. Isso permite que a transferência já iniciada continue quando a página perde tempo de CPU ou é suspensa em background, dentro das políticas do navegador. O scheduler continua sendo a autoridade que limita a três transferências iniciadas pelo Home Music.

Em navegadores sem Background Fetch — incluindo Safari/iPhone/iPad no suporte atual — o Home Music mantém o `fetch()` da página como fallback, sem alterar a experiência existente nem prometer continuidade com tela bloqueada.

O namespace por usuário é:

```text
home-music:offline-user-id:v1
home-music:offline-tracks:v2:<userId>
home-music:offline-references:v1:<userId>
home-music-offline-audio-v2-<userId>
home-music-offline-client-scope-v1
/offline-audio/<trackId>
```

A chave do scheduler continua sendo `userId + trackId`, então a mesma faixa física é reutilizada quando pertence a várias coleções.

## Referências de playlist/pasta

O manifesto `offline-references:v1` separa intenção lógica dos bytes físicos:

```text
trackId físico único
       ↑
       ├── individual
       ├── playlist
       └── pasta
```

Playlists persistem snapshot ordenado dos `trackIds`. Pastas persistem o conjunto completo de `folderView.allTracks`, incluindo subpastas e sem aplicar busca/filtro temporário.

Quando o conteúdo conectado muda, o snapshot aparece como desatualizado e o usuário aplica `Atualizar offline` explicitamente.

Remover uma coleção só apaga bytes que não tenham mais nenhuma referência.

Downloads físicos existentes anteriores ao manifesto de referências são migrados conservadoramente como intenções individuais.

Detalhes de concorrência, pause/remove e garbage-collection: [offline-downloads.md](offline-downloads.md).

## Rota virtual de áudio

O service worker atende:

```text
/offline-audio/<trackId>
```

Ela:

- não é rota pública do Fastify;
- lê somente o cache offline da conta associada ao `clientId`/aba;
- suporta `GET`, `HEAD` e byte ranges para seek;
- responde `206` para range válido e `416` para range inválido;
- não escolhe usuário por parâmetro de URL.

Coleções continuam sendo referências frontend sobre o mesmo artefato físico.

## Capability e isolamento por client

O protocolo do service worker é **versão 4**.

O frontend negocia a capability informando o `userId` autenticado. O worker associa esse usuário ao `clientId` e persiste somente o vínculo mínimo em `home-music-offline-client-scope-v1` para sobreviver à suspensão/restart do worker.

A resposta v4 continua anunciando `offlineAudio` e passa a anunciar `backgroundFetch` somente quando a API está disponível no registro ativo. Um bundle novo controlado temporariamente por worker v3 não tenta Background Fetch: ele cai no fluxo foreground até o worker v4 assumir o controle.

Quando uma Background Fetch termina com sucesso, o navegador desperta o service worker. O worker aceita somente registrations com `userId + trackId` válidos, confirma que existe exatamente uma requisição `GET` same-origin para `/api/tracks/<trackId>/stream`, exige resposta completa HTTP `200` e grava os bytes no cache offline daquele usuário.

O **manifesto físico não é publicado pelo service worker**. Quando a página volta a executar, o fluxo normal confirma o blob, revalida que a referência lógica ainda existe e só então publica `offline-tracks:v2`. Se a referência tiver sido removida durante o background, o blob é apagado e a faixa não aparece como concluída.

Trocas rápidas de conta continuam serializadas no escopo por client; cada job de download também captura o `userId` proprietário no início. Uma conclusão em background grava no cache do proprietário original, não no usuário que eventualmente esteja ativo depois.

> Cache Storage e `localStorage` pertencem ao perfil do navegador. O isolamento por usuário é fronteira lógica de produto, não criptografia contra alguém que controla DevTools/armazenamento local.

## Entrada no modo offline

O Home Music diferencia:

1. **servidor acessível, sessão inválida:** autenticação normal; offline não é bypass de login;
2. **servidor realmente inalcançável:** com namespace conhecido/válido, a interface pode abrir apenas conteúdo já salvo daquela conta.

No modo offline não são simulados dados dependentes do servidor como Administração, rescan, favoritos remotos ou edição de playlists.

A biblioteca local organiza:

- coleções offline (playlists/pastas);
- downloads individuais.

Coleções parciais reproduzem somente as faixas realmente presentes no cache. O total de armazenamento conta bytes físicos únicos, não soma referências duplicadas.

## Armazenamento e quota

No fluxo foreground, antes de concluir novo artefato o frontend usa `navigator.storage.estimate()` quando disponível e solicita persistência como best-effort.

No caminho de Background Fetch, o navegador controla a reserva/limite da própria transferência e pode encerrá-la com `quota-exceeded`. O Home Music não publica o manifesto físico quando a transferência ou a persistência no Cache Storage falha.

O navegador ainda pode remover dados sob pressão severa. O Home Music nunca marca uma faixa física como concluída sem confirmar que os bytes existem no cache e atualizar o manifesto físico somente depois da revalidação da referência lógica.

Na inicialização, o manifesto físico é reconciliado com Cache Storage; referências lógicas permanecem para permitir recuperação explícita de coleções que ficaram parciais. Blobs sem manifesto são tratados como órfãos e removidos pela reconciliação.

Logout não apaga automaticamente downloads concluídos. A troca de identidade esconde o namespace anterior e negocia novo escopo com o worker.

## Limite de background

O comportamento agora é progressivo:

- **Background Fetch disponível + worker v4:** uma transferência já iniciada pode continuar sob suspensão/background e o service worker persiste a resposta completa;
- **sem Background Fetch:** o scheduler usa o `fetch()` foreground anterior e a suspensão de JavaScript pode interromper a transferência;
- **Safari/iPhone/iPad:** permanece no fallback enquanto a plataforma não expuser a API;
- **recarregar/fechar a aba:** não é tratado como garantia de retomada/publicação do job; o foco da #81 continua sendo background/tela bloqueada em hardware real;
- **download concluído e publicado:** permanece até remoção lógica ou eviction do navegador.

A implementação não transforma suporte de API em garantia de sistema operacional. A issue [#81](https://github.com/felipe-urgal/home-music/issues/81) continua aberta até a matriz final ser repetida em Android e iPhone/iPad reais no head que contiver esta mudança.

## Evoluções abertas

- [#81](https://github.com/felipe-urgal/home-music/issues/81): validar no hardware final o caminho Background Fetch em Android/Chromium e documentar o fallback observado em iPhone/iPad/Safari.

A implementação de playlists/pastas offline deduplicadas pertence à [#174](https://github.com/felipe-urgal/home-music/issues/174) e reutiliza o scheduler/cache existente, sem segundo pipeline físico. A identidade de instalação da #176 está documentada em [pwa-icon-identity.md](pwa-icon-identity.md).
