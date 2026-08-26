# Fase 7.5 — Troca obrigatória de senha

Este documento registra a implementação da atividade de senha temporária forte e troca obrigatória no primeiro login da Fase 7.5. As invariantes gerais continuam em `multi-user-auth.md`; a geração/reset administrativo de senha temporária está detalhada em `phase-7.5-admin-users-api.md`.

## Objetivo

Uma conta criada ou resetada por administrador recebe uma senha temporária aleatória e fica com `password_must_change = 1`.

Essa credencial não pode liberar o uso normal do Home Music. O backend cria somente uma sessão restrita, suficiente para:

- consultar `/api/auth/status`;
- trocar a senha em `/api/auth/password`;
- encerrar a sessão em `/api/auth/logout`.

Qualquer outra rota autenticada ou administrativa é recusada enquanto a flag estiver ativa.

## Senha temporária

A criação/reset administrativo já gera 18 bytes aleatórios e serializa em base64url, produzindo uma senha temporária de 24 caracteres. Somente o hash `scrypt` é persistido; a senha em claro é retornada uma única vez ao administrador.

Criação e reset mantêm `password_must_change = 1`.

## Política da nova senha

A senha definitiva usada para concluir a troca obrigatória deve:

- ter pelo menos 12 caracteres Unicode;
- não ser composta somente por whitespace;
- respeitar o limite técnico de 1024 bytes UTF-8 do módulo criptográfico;
- ser diferente da senha temporária atual.

Não são exigidos números, símbolos ou combinações artificiais de classes de caracteres. A política favorece passphrases longas e não normaliza, não faz `trim` e não altera semanticamente a senha antes do hash. O `trim` é usado somente para rejeitar o caso degenerado de uma senha composta exclusivamente por whitespace.

## Login transitório

O login multiusuário completo continua bloqueado até as migrations de ownership de favoritos, histórico, playlists manuais e estado de reprodução.

Existe uma exceção deliberadamente estreita: uma conta ativa com `password_must_change = 1` pode validar sua senha temporária persistida no SQLite e receber uma sessão identificada restrita.

Uma conta persistida com `password_must_change = 0` ainda não passa a ter login normal nesta atividade. Isso evita antecipar o multiusuário enquanto dados pessoais ainda são globais.

## Fronteira no backend

Quando a sessão resolve para um usuário com `password_must_change = 1`, a política central responde `403` nas rotas de uso normal:

```json
{
  "error": "Troca de senha obrigatória antes de continuar.",
  "code": "PASSWORD_CHANGE_REQUIRED"
}
```

A regra é aplicada antes da autorização por role. Portanto até um `admin` com troca pendente não consegue usar `/api/admin/*` antes de definir a nova senha.

## Fluxo visual de primeiro acesso

O frontend possui um gate no topo da aplicação. Ao detectar `passwordChangeRequired=true` em `/api/auth/status`, o fluxo normal não monta biblioteca, player nem demais superfícies protegidas.

Em vez disso, o usuário vê uma tela dedicada para:

- informar novamente a senha temporária;
- definir e confirmar a nova senha;
- sair da conta se não quiser concluir naquele momento.

A validação visual melhora a UX, mas não substitui o bloqueio do backend. Mesmo que o cliente seja adulterado, as demais rotas continuam retornando `403` enquanto `password_must_change = 1`.

## Status de autenticação

`/api/auth/status` mantém o objeto público de identidade mínimo:

```text
id
username
role
```

A necessidade de troca é retornada separadamente em `passwordChangeRequired`.

Assim `password_must_change` continua sendo estado de autenticação/conta, e não parte permanente da identidade pública.

## Endpoint de troca

`POST /api/auth/password`

Body:

```json
{
  "currentPassword": "senha temporária",
  "newPassword": "nova senha"
}
```

A rota é autenticada e, como toda mutação da API, exige `X-Home-Music-Request: 1`.

Em sucesso o serviço:

1. confirma que a conta continua ativa e com troca pendente;
2. verifica a senha temporária atual com `scrypt`;
3. valida a política da nova senha;
4. deriva o novo hash de forma assíncrona;
5. atualiza `password_hash`, limpa `password_must_change` e atualiza timestamps somente se o hash antigo ainda for o mesmo;
6. revoga todas as sessões do usuário, inclusive a sessão usada na troca;
7. limpa o cookie da resposta.

O usuário precisa autenticar novamente depois da troca. O login normal da segunda conta continuará aguardando as migrations de ownership descritas acima.

## Concorrência e estado stale

Operações com `scrypt` podem levar tempo suficiente para o estado da conta mudar em outra conexão.

Por isso:

- o login com senha temporária relê `enabled`, `password_must_change` e `password_hash` depois da verificação criptográfica;
- o login legado do primeiro administrador também exige que a senha do `.env` ainda corresponda ao hash atual no SQLite;
- a troca usa um `UPDATE` condicional pelo hash antigo e retorna conflito se a credencial mudou enquanto o novo hash era calculado.

Esse desenho impede que uma desativação ou reset concorrente seja ignorado por uma autorização calculada antes da KDF terminar.

## Credencial legada do `.env`

Enquanto o bootstrap ainda depende de `HOME_MUSIC_USER`/`HOME_MUSIC_PASSWORD`, a comparação com o `.env` não é mais suficiente quando existe usuário persistido.

Para uma credencial legada vinculada, o servidor também verifica a mesma senha contra o `password_hash` atual do usuário ativo no SQLite.

Isso fecha o caso em que um reset administrativo revogaria sessões e alteraria o hash, mas a senha antiga do `.env` poderia otherwise continuar criando novas sessões.

## Semântica de erro da troca

- `400`: senha temporária incorreta, nova senha fraca ou igual à temporária;
- `401`: sessão ausente/expirada;
- `403`: rota normal chamada enquanto a troca ainda é obrigatória;
- `409`: a conta não possui troca pendente ou mudou durante a operação.

## Testes de regressão

A implementação cobre:

- política mínima da nova senha e rejeição de whitespace-only;
- login transitório somente para conta ativa com troca pendente;
- username normalizado no login temporário;
- senha legada vinculada conferida também contra o hash atual do SQLite;
- bloqueio de rotas normais e administrativas pelo backend;
- liberação somente de troca/logout durante a sessão restrita;
- `passwordChangeRequired` no status sem ampliar o objeto de identidade;
- troca correta do hash e limpeza de `password_must_change`;
- revogação de todas as sessões após a troca;
- login pendente falhando fechado se a conta for desativada durante `scrypt`;
- troca abortando se o hash for resetado concorrentemente;
- gate visual impedindo a montagem do app normal enquanto a troca estiver pendente.
