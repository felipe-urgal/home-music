# Sessões da conta

A sessão é identificada exclusivamente por um token aleatório secreto em cookie
HttpOnly, SameSite=Strict, e pelo hash SHA-256 do token na tabela `auth_sessions`.
A autorização de listagem e revogação sempre usa `request.user.id` e o token
autenticado atual. O nome do dispositivo **nunca** é usado para autorizar ações.

## Identificação de dispositivo

O servidor interpreta apenas o `User-Agent` do **login** e guarda
`client_name` com categorias conhecidas de navegador/app e plataforma genérica,
como `Chrome · Linux`, `Firefox · Android` e `Home Music TV`.
Nenhuma versão, IP, user agent bruto ou fingerprint é persistido.
Este dado não é atestado e pode ser falsificado pelo cliente; é somente
uma pista visual para reconhecer sessões e não uma garantia de dispositivo.

A migração adiciona `client_name TEXT` de maneira transacional quando a tabela
antiga não possui a coluna. Dados antigos ficam como `NULL`; a interface exibe
"Dispositivo não identificado" com última atividade, criação e ID público
abreviado para diagnóstico. Token antigo e vínculo com usuário são preservados.

## Política de lifecycle

As sessões persistentes do servidor não possuem expiração automática por
inatividade (sentinela de data 9999). O cookie de autenticação tem Max-Age
de 400 dias e é renovado durante a consulta de status, porém isso não
invalida automaticamente o registro persistido no banco quando o cookie
expira. Uma nova política de TTL exige decisão e issue próprias.

O servidor limita sessões por usuário e descarta primeiro a mais antiga
**antes** de inserir a sessão nova. Se o limite global de sessões for atingido
por outras contas, retorna erro de capacidade sem expulsar usuários alheios.
Reiniciar o servidor não invalida sessões existentes.
Trocar senha revoga todas as sessões do usuário, inclusive a atual;
encerrar outras sessões preserva a atual; a revogação individual não
permite encerrar a sessão atual nem uma sessão pertencente a outra conta.

## Verificação

- `npm run check`
- `npm run test:security`
- `npm --prefix e2e test -- tests/account-security.spec.ts`

Os testes do servidor cobrem migração, restart, eviction e revogação
por alteração de senha; os testes de navegador exercitam os layouts
mobile/tablet/desktop, diálogos, cancelamento, erro e fallback.
