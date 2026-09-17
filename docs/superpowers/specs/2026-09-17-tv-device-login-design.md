# Login da TV pelo celular

## Estado

Desenho aprovado em 2026-09-17. Implementação pendente.

## Objetivo

Eliminar a necessidade de digitar usuário e senha com o controle remoto na experiência TV. O caminho principal passa a ser **Entrar com o celular**: a TV exibe um QR Code, o celular autenticado aprova a entrada e o servidor cria uma sessão própria para a TV.

O formulário tradicional de usuário e senha continua disponível como fallback.

## Princípio de segurança

O celular **não transfere senha, cookie nem token de sessão para a TV**. A sessão do celular serve apenas para autorizar uma solicitação efêmera. Depois da aprovação, o servidor cria uma nova sessão para o mesmo usuário usando a infraestrutura existente de `SessionManager`.

Consequências:

- celular e TV possuem sessões independentes;
- logout da TV não encerra o celular;
- logout do celular não precisa encerrar imediatamente a TV;
- a sessão da TV aparece no gerenciamento normal de sessões e pode ser revogada;
- nenhum segredo da sessão já autenticada sai do navegador do celular.

## Experiência na TV

A tela de entrada da TV prioriza:

1. título **Entrar no Home Music**;
2. QR Code grande;
3. instrução **Escaneie com o celular para entrar**;
4. código curto de confirmação, legível à distância;
5. estados de progresso;
6. ação para gerar um novo código;
7. opção secundária **Entrar com usuário e senha**.

Estados visíveis:

- **Gerando código**;
- **Aguardando celular**;
- **Aprovação recebida / entrando**;
- **Código expirado**;
- **Acesso recusado**;
- **Não foi possível entrar**.

Ao expirar ou falhar, a TV oferece uma ação explícita para gerar outra solicitação. Não existe retry infinito oculto.

## Experiência no celular

O QR abre uma superfície dedicada do Home Music, conceitualmente `/tv-login`.

Se o celular já estiver autenticado, a pessoa vê uma confirmação curta:

- **Entrar nesta TV?**;
- o mesmo código curto mostrado na TV;
- **Autorizar**;
- **Recusar**.

Se o celular ainda não estiver autenticado, o Home Music apresenta o login normal no próprio celular. Após autenticar, retorna à confirmação da TV sem exigir novo scan enquanto a solicitação continuar válida.

A tela do celular nunca mostra nem solicita o segredo privado mantido pela TV.

## Fluxo de protocolo

### 1. Criar solicitação

A TV chama `POST /api/auth/device/start` como rota pública da autenticação, mantendo `X-Home-Music-Request: 1`.

Resposta conceitual:

```ts
type TvDeviceLoginStart = {
  requestId: string;
  deviceToken: string;
  approvalToken: string;
  displayCode: string;
  expiresAt: string;
};
```

- `requestId` é um identificador aleatório e não funciona sozinho como credencial;
- `deviceToken` é um bearer secret conhecido somente pela TV e usado para consultar/consumir a solicitação;
- `approvalToken` é conhecido por quem lê o QR e permite aprovar/recusar somente quando acompanhado por uma sessão autenticada no celular;
- `displayCode` é confirmação humana e **não** autoriza login sozinho.

O frontend monta o QR localmente. O `approvalToken` deve ficar no fragmento da URL, por exemplo `/tv-login#<approvalToken>`, para não aparecer no request URL, access log ou `Referer`. Depois de carregar a aplicação, o frontend lê o fragmento e remove o valor visível da barra de endereço com `history.replaceState`.

### 2. Aguardar aprovação

A TV consulta periodicamente o estado usando `requestId` + `deviceToken`. O MVP usa polling REST simples em vez de WebSocket/SSE porque há pouco volume, TTL curto e somente uma transição relevante para a TV.

O token privado deve ir em header, não em query string.

Resposta pública mínima:

```ts
type TvDeviceLoginState =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'consumed';
```

A consulta não devolve senha, cookie, `userId`, papel, nome de usuário ou outro dado de conta.

### 3. Aprovar no celular

O celular autenticado envia o `approvalToken` ao servidor. O servidor deriva a identidade exclusivamente de `request.user.id` e associa esse usuário à solicitação.

A aprovação só é aceita se a solicitação estiver `pending`, não expirada e ainda não consumida. Sessões com troca obrigatória de senha continuam sujeitas à política central antes de poder autorizar uma TV.

### 4. Consumir na TV

Quando a TV observa `approved`, chama o endpoint de consumo usando `requestId` + `deviceToken`.

O servidor, em uma operação atômica:

1. valida a solicitação e o segredo da TV;
2. confirma `approved` e TTL válido;
3. marca a autorização como `consumed`;
4. cria uma nova sessão com `SessionManager.createSessionForUser(approvedUserId)`;
5. responde com `Set-Cookie` usando a política de cookie já existente.

Um segundo consumo deve falhar sem criar outra sessão.

Depois do cookie ser criado, a TV usa o fluxo atual de `/api/auth/status`; não existe um tipo especial de sessão de playback.

## Estado efêmero no servidor

O MVP usa um `TvDeviceLoginManager` process-local, seguindo o padrão já usado por sessões efêmeras do controle remoto.

Cada solicitação guarda somente o necessário:

```ts
type TvDeviceLoginRequest = {
  requestId: string;
  deviceTokenHash: string;
  approvalTokenHash: string;
  displayCode: string;
  state: TvDeviceLoginState;
  approvedUserId: string | null;
  createdAt: number;
  expiresAt: number;
};
```

Tokens brutos não ficam armazenados. Reiniciar o servidor invalida solicitações pendentes; a TV gera outro QR. Não há migration, backup nem persistência para esse estado transitório.

TTL inicial: **5 minutos**. Expiração é verificada tanto nas leituras quanto nas mutações e há cleanup periódico/best-effort para limitar memória.

## Proteções contra abuso e replay

O contrato deve garantir:

- `crypto.randomBytes`/entropia equivalente para `requestId`, `deviceToken` e `approvalToken`;
- comparação de segredos por hash/timing-safe quando aplicável;
- consumo único e transição de estado monotônica;
- `Cache-Control: no-store` em todas as rotas do fluxo;
- `X-Home-Music-Request: 1` nas mutações;
- limites de solicitações pendentes e rate limit para `start`;
- limite de tamanho/forma dos tokens recebidos antes de lookup/hash;
- mesma resposta para segredo inválido e solicitação inexistente onde a distinção puder facilitar enumeração;
- nenhum token completo em logs, mensagens de erro, analytics ou documentação de runtime;
- `displayCode` nunca aceito como credencial de aprovação ou consumo.

Como ponto de partida, o manager deve possuir capacidade global limitada e um pequeno cap de solicitações simultâneas por origem/IP. Os valores finais ficam como constantes cobertas por teste para poderem ser ajustados sem alterar o protocolo.

## Cancelamento e regeneração

A TV pode cancelar a própria solicitação usando o `deviceToken`. Gerar novo QR cancela a solicitação anterior daquela tela antes de criar outra.

No celular, **Recusar** muda `pending -> denied`. Fechar a tela sem responder não precisa chamar endpoint; o TTL resolve o abandono.

Depois de `denied`, `expired` ou `consumed`, nenhuma aprovação posterior é aceita.

## Integração com autenticação atual

O fluxo deve reutilizar:

- `SessionManager.createSessionForUser` para criar a sessão da TV;
- `buildSessionCookie` e as mesmas flags de cookie do login por senha;
- política central de `/api/*` para CSRF e autenticação;
- `/api/auth/status` para bootstrap depois do consumo;
- `/api/auth/sessions` para listagem/revogação posterior da sessão da TV.

A lógica de device login não deve duplicar validação de senha nem criar um segundo repositório de sessões autenticadas.

## Separação do LAN bridge

O login da conta é independente de `home-music-lan-remote-v2`, WebRTC, DataChannel e do bridge HTTP usado para funcionamento offline com BTV.

Motivos:

- autenticação da conta exige o servidor Home Music online;
- bridge LAN existe para transporte local e não deve receber credenciais de conta;
- manter os protocolos separados reduz superfície de ataque e acoplamento;
- o mesmo device login pode funcionar em qualquer navegador/TV que abra o Home Music, sem depender do pareamento offline.

Login pelo celular **não é login offline**. Se o servidor Home Music não estiver acessível, a autorização da conta não acontece.

## Frontend e roteamento

A implementação deve separar três responsabilidades:

- cliente de device login: start/status/approve/deny/consume/cancel;
- superfície TV: QR, polling e fallback de senha;
- superfície celular: confirmação autenticada.

`App.tsx` continua sendo a autoridade para decidir entre login, conteúdo offline e aplicação autenticada. A rota de aprovação precisa sobreviver ao login do celular sem montar a experiência TV nem o player.

O formulário atual de `LoginScreen` não deve ser removido; será reutilizado como fallback e para autenticar o celular quando necessário.

## Testes

### Servidor

Cobrir de forma determinística:

- criação e TTL;
- tokens únicos e limites;
- segredo da TV correto/incorreto;
- aprovação por usuário autenticado;
- bloqueio para não autenticado;
- `pending -> approved -> consumed`;
- `pending -> denied`;
- expiração antes de aprovar e antes de consumir;
- segundo consumo/replay;
- segundo approve/deny depois de estado terminal;
- criação da sessão para o usuário aprovado;
- capacidade de `SessionManager` esgotada sem consumir a autorização indevidamente;
- CSRF/header obrigatório;
- nenhuma exposição de identidade no polling.

### Frontend

Cobrir:

- parser/limpeza do `approvalToken` vindo do fragmento;
- geração do QR local;
- polling e parada em estados terminais;
- regeneração/cancelamento;
- retorno ao fluxo de aprovação depois do login no celular;
- fallback de usuário/senha;
- estados expirado/recusado/erro.

### E2E

Usar dois contexts do Playwright, um como TV e outro como celular:

1. TV gera solicitação;
2. celular abre a URL do QR;
3. celular autentica ou reutiliza sessão existente;
4. celular confirma o mesmo `displayCode`;
5. autoriza;
6. TV consome e passa a responder autenticada;
7. cookies dos dois contexts são diferentes;
8. logout/revogação da TV não encerra o celular;
9. replay da autorização não cria uma segunda sessão.

## Homologação física

CI não substitui teste no BTV real. Após deploy, validar com pelo menos BTV + iPhone:

- leitura do QR à distância normal;
- abertura no Safari;
- login do celular quando necessário;
- retorno automático à confirmação após login;
- correspondência do código curto TV/celular;
- aprovação e entrada da TV sem teclado/controle;
- expiração e gerar novo código;
- fallback de usuário/senha;
- persistência da sessão após reiniciar/reabrir o app da TV;
- logout da TV sem deslogar o celular.

## Fora do escopo inicial

- login sem servidor/internet para a conta;
- transportar autenticação pelo bridge LAN/WebRTC;
- confiar permanentemente em uma TV sem sessão normal;
- painel específico de “TVs confiáveis”;
- push notification para aprovar TV;
- aprovação por código digitado manualmente como fluxo principal;
- OAuth/passkeys como substituição da autenticação atual;
- reconciliação de autorização pendente após restart do servidor.
