# PWA, cache seletivo e downloads offline

Este documento descreve o comportamento **atual** da PWA do Home Music. Para scheduler, referências lógicas, deduplicação, sincronização e matriz de validação mobile, veja também [offline-downloads.md](offline-downloads.md).

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

## Downloads offline

Áudio offline é explícito e usa armazenamento separado do app shell.

O frontend possui um scheduler global com até **3 operações simultâneas**. Ele é compartilhado por download individual, lote desktop, playlists e pastas. Navegar na SPA não cria uma segunda fila.

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

A #174 não altera esse protocolo: coleções são referências frontend sobre o mesmo artefato físico.

## Capability e isolamento por client

O protocolo do service worker permanece **versão 3**.

O frontend negocia a capability informando o `userId` autenticado. O worker associa esse usuário ao `clientId` e persiste somente o vínculo mínimo em `home-music-offline-client-scope-v1` para sobreviver à suspensão/restart do worker.

O worker só considera o client pronto depois de persistir e confirmar o escopo. Trocas rápidas de conta são serializadas para que a identidade mais recente vença.

Essa camada evita que contas diferentes no mesmo origin reutilizem downloads umas das outras no uso normal.

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

Antes de concluir novo artefato, o frontend usa `navigator.storage.estimate()` quando disponível e solicita persistência como best-effort.

O navegador ainda pode remover dados sob pressão severa. O Home Music nunca marca uma faixa física como concluída sem `cache.put()` + atualização do manifesto físico.

Na inicialização, o manifesto físico é reconciliado com Cache Storage; referências lógicas permanecem para permitir recuperação explícita de coleções que ficaram parciais.

Logout não apaga automaticamente downloads concluídos. A troca de identidade esconde o namespace anterior e negocia novo escopo com o worker.

## Limite de background

O scheduler vive na execução da página. Navegar na SPA preserva jobs; fechar/recarregar a aba ou suspensão de JavaScript pelo sistema pode interrompê-los.

A garantia de continuidade com tela bloqueada/background ainda exige validação real em Android e iPhone/iPad. A issue [#81](https://github.com/felipe-urgal/home-music/issues/81) continua sendo o gate específico de hardware e não é fechada pela #174.

## Evoluções abertas

- [#81](https://github.com/felipe-urgal/home-music/issues/81): validar comportamento real em background/tela bloqueada;
- [#176](https://github.com/felipe-urgal/home-music/issues/176): revisar ícone, favicon e identidade visual da PWA em tamanhos reais de launcher.

A implementação de playlists/pastas offline deduplicadas pertence à [#174](https://github.com/felipe-urgal/home-music/issues/174) e reutiliza o scheduler/cache existente, sem segundo pipeline físico.
