# Fase 7.5 — Bootstrap do primeiro administrador

Este documento detalha o bootstrap do primeiro administrador e complementa a seção 6 de [multi-user-auth.md](multi-user-auth.md).

## Objetivo

Converter de forma segura e idempotente `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` no primeiro registro real de `users`. Essas variáveis existem somente para a primeira inicialização; depois que a identidade está persistida, autenticação normal, readiness e sessões usam exclusivamente o SQLite.

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
   ├─ sim → não lê nem exige credencial de bootstrap
   └─ não
       ↓
HOME_MUSIC_USER / HOME_MUSIC_PASSWORD são válidos?
   ├─ não → não cria identidade; auth permanece não configurada
   └─ sim
       ↓
hash scrypt da senha
       ↓
BEGIN IMMEDIATE
       ↓
reconfere se users continua vazio
       ↓
cria primeiro admin + reivindica dados pessoais legados pendentes
       ↓
COMMIT
        ↓
dist/index.js autentica pelo SQLite
```

## Invariantes

- O bootstrap só cria usuário quando `users` está vazio.
- Depois que qualquer usuário existe, `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` deixam de participar do runtime e podem ser removidos do `.env`.
- Mudanças posteriores nessas variáveis nunca sobrescrevem identidade ou senha persistidas.
- O primeiro usuário recebe `role = admin`, `enabled = true` e `password_must_change = false`.
- `password_changed_at`, `created_at` e `updated_at` recebem o instante do bootstrap.
- A senha é persistida somente como hash `scrypt` versionado.
- O username usa a normalização única `trim` + Unicode NFKC + lowercase para a chave de unicidade.
- A senha não sofre trim ou normalização antes do hash.
- A senha de bootstrap precisa ter pelo menos 12 caracteres e respeitar o teto técnico de 1024 bytes UTF-8.
- A criação usa `BEGIN IMMEDIATE` e uma segunda leitura dentro da transação para impedir duplicação concorrente.
- A operação é idempotente: reiniciar o serviço não cria novos admins.
- Nenhuma mensagem de log inclui senha ou hash completo.

## Estado final da autenticação

O login não usa mais o username/senha do ambiente depois do bootstrap. `/api/auth/login` normaliza o username, localiza a conta persistida, verifica o hash do SQLite e cria uma sessão associada ao `userId`.

Isso vale para `admin` e `user`, inclusive depois que uma conta conclui a troca da senha temporária. A flag `password_must_change` apenas restringe as rotas disponíveis até a troca obrigatória; ela não define um mecanismo paralelo de login.

`/ready` e `/api/auth/status` consideram autenticação configurada quando existe ao menos uma conta habilitada com credencial persistida. Portanto remover as variáveis de bootstrap não degrada readiness depois da migração.

## Remoção segura das variáveis

Em uma instalação existente, faça a transição nesta ordem:

1. atualize para a versão que autentica pelo SQLite;
2. confirme `/ready` e faça login com o administrador atual;
3. remova `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` do `.env`;
4. reinicie o serviço;
5. confirme novamente readiness e login.

Não remova as variáveis antes de implantar a versão que contém o login persistido.

## Falhas e recuperação

### Primeiro bootstrap ainda não ocorreu

Se `users` estiver vazio e as variáveis estiverem ausentes ou inválidas, nenhum usuário é criado e a autenticação permanece não configurada. `/api/auth/status` continua disponível para informar esse estado, enquanto as demais APIs falham fechado.

Corrija as variáveis de bootstrap e reinicie. Depois da criação bem-sucedida, elas deixam de ser necessárias.

### Banco já inicializado

Se `users` possuir qualquer linha, o bootstrap encerra sem recalcular hash e sem alterar a conta existente. Esse comportamento impede que uma edição acidental do `.env` redefina um administrador real.

### Perda de acesso após o bootstrap

A recuperação não reutiliza variáveis do ambiente e não cria uma conta paralela. Com acesso local ao Ubuntu:

```bash
sudo systemctl stop home-music
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
sudo systemctl start home-music
```

O comando:

- recusa execução se `home-music.service` ainda estiver ativo;
- exige que o usuário já exista no SQLite;
- reativa e promove a conta para `admin`;
- substitui a credencial por uma senha temporária forte exibida uma única vez no terminal;
- marca `password_must_change = 1`;
- não cria usuário novo e não aceita uma senha escolhida por argumento ou variável de ambiente.

Parar o serviço antes da alteração invalida todas as sessões mantidas em memória. Depois de iniciar novamente, use a senha temporária e troque-a imediatamente pela interface.

## Testes

A cobertura relevante inclui:

- criação e idempotência do primeiro administrador;
- login normal de `admin` e `user` usando somente hashes persistidos;
- troca obrigatória de senha preservada no login persistido;
- readiness configurado a partir do SQLite;
- recuperação local preservando o mesmo `userId`, reativando/promovendo a conta e invalidando a senha anterior;
- rejeição de recuperação para usuário inexistente;
- validação do admin persistido antes de habilitar Tailscale Funnel.
