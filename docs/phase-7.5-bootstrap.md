# Fase 7.5 — Bootstrap do primeiro administrador

Este documento detalha a implementação da atividade **bootstrap do primeiro administrador** e complementa a seção 6 de [multi-user-auth.md](multi-user-auth.md).

## Objetivo

Converter de forma segura e idempotente as credenciais legadas `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` no primeiro registro real de `users`, sem trocar ainda o mecanismo de login em produção e sem criar risco de lockout durante a transição.

## Fluxo de startup

No perfil de produção, `npm start` executa `bootstrap-preload.js` antes de `dist/index.js`.

```text
systemd / npm start
        ↓
bootstrap-preload
        ↓
garante schema SQLite atual
        ↓
users já possui registro?
   ├─ sim → não altera nada
   └─ não
       ↓
credenciais legadas podem ser migradas?
   ├─ não → registra warning e preserva login legado
   └─ sim
       ↓
hash scrypt da senha
       ↓
BEGIN IMMEDIATE
       ↓
reconfere se users continua vazio
       ↓
cria primeiro admin
       ↓
COMMIT
        ↓
dist/index.js inicia normalmente
```

## Invariantes

- O bootstrap só cria usuário quando `users` está vazio.
- Depois que qualquer usuário existe, mudanças em `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` nunca sobrescrevem a identidade persistida.
- O primeiro usuário recebe `role = admin` e `enabled = true`.
- O usuário migrado recebe `password_must_change = false`: a senha atual já era a senha efetiva do administrador, não uma senha temporária criada por terceiro.
- `password_changed_at`, `created_at` e `updated_at` recebem o instante do bootstrap.
- A senha é persistida somente como hash `scrypt` no formato versionado definido em `multi-user-auth.md`.
- O username é normalizado por uma função única: `trim` + Unicode NFKC + lowercase para a chave de unicidade. Caracteres de controle e identidades vazias/excessivamente longas são recusados.
- A senha não sofre trim, normalização ou alteração semântica antes do hash.
- Para preservar compatibilidade com o login legado atual, a senha precisa continuar respeitando o mínimo atual de 12 caracteres e também o teto técnico do módulo de hash.
- A criação usa `BEGIN IMMEDIATE` e faz uma segunda leitura dentro da transação para impedir duplicação em inicializações concorrentes.
- A operação é idempotente: reiniciar o serviço não cria novos admins.
- Um erro no bootstrap não impede `dist/index.js` de iniciar nesta etapa; o login legado permanece como fallback temporário e o bootstrap é tentado novamente no próximo start.
- Nenhuma mensagem de log inclui senha ou hash completo.

## Por que o login ainda continua legado

Esta atividade apenas garante a existência segura da identidade persistida. O `SessionManager` ainda não associa sessão a `userId` e o endpoint de login ainda valida as credenciais legadas.

A troca da autenticação para o SQLite só ocorrerá após as próximas atividades de sessão/identidade. Isso evita uma mudança grande e difícil de auditar em um único PR.

Consequência temporária importante:

- ainda **não** remover `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` do `.env`;
- o registro SQLite já existe, mas o login real continua dependendo das credenciais legadas até a etapa de autenticação multiusuário ser concluída.

## Falhas e recuperação

### Credenciais não migráveis

Se `users` estiver vazio e o username/senha legado não couber nas regras de bootstrap, nenhum usuário é criado. O serviço continua na autenticação legada desta etapa e o journal informa que o bootstrap não foi executado.

### Falha técnica

Erro de hash, SQLite ou transação é registrado sem segredos. Nenhuma linha parcial deve permanecer porque a inserção é transacional. O processo principal continua usando o login legado e uma reinicialização posterior tenta novamente.

### Banco já inicializado

Se `users` possuir qualquer linha, o bootstrap encerra sem recalcular hash e sem alterar a conta existente. Esse comportamento é intencional para impedir que uma edição acidental do `.env` redefina um administrador real.

## Testes desta atividade

Os testes automatizados cobrem:

- normalização de username;
- criação do primeiro admin;
- role/flags/timestamps esperados;
- senha não persistida em claro e hash verificável;
- idempotência após reinício;
- alteração posterior das credenciais legadas sem overwrite;
- credenciais não migráveis sem criação parcial;
- inicializações concorrentes criando no máximo um administrador.

A CI existente continua responsável por typecheck, testes, build, scripts operacionais, Tailscale, Playwright, Ubuntu 26.04 e smoke real de produção.
