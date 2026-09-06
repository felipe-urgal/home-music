# Frontend com `currentUser` e superfícies por role

## Objetivo

Propagar a identidade autenticada mínima já retornada por `/api/auth/status` para a aplicação autenticada e usar `currentUser.role` somente para adequar a experiência visual entre `admin` e `user`.

Esta etapa **não cria uma nova fronteira de autorização**. O backend continua sendo a autoridade e deve recusar qualquer operação sem permissão mesmo quando a chamada for feita manualmente fora da UI.

## Fonte da identidade

`useAuth()` mantém `currentUser` como `AuthenticatedUser | null`, alimentado pela resposta de `/api/auth/status`.

A aplicação autenticada só é montada quando as duas condições são verdadeiras:

- `authenticated === true`;
- `currentUser` está presente.

Se a resposta ficar inconsistente (`authenticated` sem usuário), o frontend falha fechado e não monta as superfícies autenticadas.

O cliente não persiste nem aceita `role` por query string, formulário ou preferência local. O papel utilizado na composição da UI vem da identidade confirmada pelo servidor.

## Matriz de superfícies

| Superfície | `admin` | `user` | Segurança real |
| --- | --- | --- | --- |
| Player e biblioteca compartilhada | sim | sim | rota autenticada no backend |
| Favoritos, histórico, estatísticas e playlists manuais pessoais | sim | sim | ownership no backend |
| Visualizar playlists Rekordbox compartilhadas | sim | sim | leitura autenticada |
| Criar/editar/excluir playlist manual própria | sim | sim | ownership no backend |
| Re-scan manual da biblioteca | sim | não exibido | `/api/library/scan` exige `admin` |
| Preview/importação Rekordbox | sim | não exibido | endpoints de integração exigem `admin` |
| Alterar/excluir playlist Rekordbox individualmente | não | não | Rekordbox permanece compartilhado e somente leitura fora da reimportação |
| `/api/health` detalhado | sem superfície nesta etapa | sem superfície nesta etapa | endpoint exige `admin` |
| `/api/admin/*` | telas futuras | telas futuras não exibidas | namespace inteiro exige `admin` |

## Implementação

A regra visual administrativa fica centralizada em `apps/web/src/frontend-access.ts`.

`App.tsx` passa `currentUser` para a aplicação autenticada e para `LibraryScreen`. O estado vazio da biblioteca só oferece "Atualizar biblioteca" para administradores.

`LibraryScreen` usa a mesma regra para:

- exibir o botão de re-scan somente para `admin`;
- exibir upload/preview/importação Rekordbox somente para `admin`;
- manter criação e edição de playlists manuais disponível para qualquer usuário autenticado;
- manter playlists Rekordbox visíveis para todos, mas apresentadas como somente leitura.

Nenhuma função de API foi removida do bundle como mecanismo de segurança. Isso é intencional: esconder controles melhora UX, enquanto a autorização efetiva continua centralizada no servidor.

## Regressões cobertas

Os testes unitários de `frontend-access.ts` validam que:

- `admin` recebe superfícies administrativas;
- `user` não recebe superfícies administrativas;
- identidade ausente falha fechado.

Os testes existentes do backend continuam sendo a proteção contra chamadas manuais indevidas.

## Review sênior

Validar antes do merge:

- `currentUser` é derivado exclusivamente do status autenticado;
- nenhuma checagem de `role` no frontend substitui o backend;
- usuários comuns não recebem controles de scan nem importação Rekordbox;
- playlists Rekordbox continuam visíveis e somente leitura;
- ações pessoais não são escondidas de `user`;
- identidade ausente não monta a aplicação autenticada;
- não há mudança de schema, migration ou contrato de API.

## Validação local

Usar Node 22+:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:production
npm run e2e:ci
```

Smoke manual recomendado com contas reais:

1. entrar como `admin` e confirmar que re-scan e importação Rekordbox aparecem;
2. entrar como `user` e confirmar que esses controles não aparecem;
3. como `user`, confirmar que player, biblioteca, favoritos, histórico, estatísticas e playlists manuais continuam funcionando;
4. confirmar que playlists Rekordbox continuam visíveis para `user`, sem ações de mutação;
5. chamar uma operação administrativa manualmente como `user` e confirmar que o backend continua respondendo com bloqueio de autorização.
