# Fase 7.5 — Credenciais de bootstrap e recuperação local

## Objetivo

Eliminar a dependência permanente de `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` sem abrir um mecanismo remoto de recuperação. Depois do primeiro bootstrap, todas as contas autenticam pelo SQLite e as duas variáveis podem ser apagadas do `.env`.

## Fronteira final

As variáveis `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` existem apenas quando `users` está vazio. O preload pode usá-las para criar o primeiro administrador; quando existe identidade persistida, ele retorna idempotentemente antes de validar qualquer credencial de ambiente.

No runtime:

- `authConfigured` é derivado de conta habilitada com hash persistido;
- `/api/auth/login` autentica username normalizado + hash do SQLite;
- a sessão criada sempre carrega `userId`;
- `admin` e `user` usam o mesmo fluxo de login;
- `password_must_change` controla somente o gate pós-login;
- editar ou recriar as variáveis de bootstrap não redefine contas existentes.

## Remoção em produção

A remoção deve acontecer somente depois de implantar esta versão e confirmar o login persistido:

```bash
git switch main
git pull --ff-only origin main
npm run service:update
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Faça um login real. Estando verde, edite `.env` e remova por completo:

```text
HOME_MUSIC_USER=...
HOME_MUSIC_PASSWORD=...
```

Depois:

```bash
sudo systemctl restart home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
npm run tailscale:public:status
```

Confirme novamente o login. Essa ordem evita retirar o fallback antes de o novo runtime estar implantado.

## Recuperação local de administrador

A recuperação exige acesso ao host e nunca é exposta por HTTP.

```bash
sudo systemctl stop home-music
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
sudo systemctl start home-music
```

Invariantes:

- o CLI verifica que `home-music.service` não está ativo;
- o alvo precisa ser uma conta já existente; não existe criação emergencial invisível à administração normal;
- o mesmo `userId` é preservado;
- a conta é reativada e promovida a `admin`;
- uma senha temporária aleatória é gerada, persistida somente como hash e exibida uma vez no terminal;
- a senha anterior deixa de funcionar;
- `password_must_change = 1`, obrigando nova senha no primeiro login;
- a senha temporária não entra em argv, `.env`, URL ou log do servidor;
- como o serviço estava parado, todas as sessões em memória já foram descartadas.

O comando deliberadamente não aceita uma nova senha escolhida pelo operador. Isso evita histórico de shell e reduz reutilização acidental de segredo.

## Tailscale Funnel

O perfil público continua exigindo uma credencial mais forte antes de tornar a URL alcançável pela internet, mas não lê mais `HOME_MUSIC_PASSWORD`.

`npm run tailscale:public:enable`:

1. valida Tailscale e a configuração atual de HTTPS/443;
2. se o Funnel já estiver corretamente ativo, retorna de forma idempotente;
3. solicita username de um administrador e sua senha atual; a senha é lida sem eco no terminal;
4. passa `username + NUL + password` por stdin ao verificador local compilado;
5. exige conta `admin`, habilitada, sem troca de senha pendente e senha atual com pelo menos 20 caracteres;
6. só então executa a transição transacional para Funnel.

A credencial não é passada em argumento de processo nem escrita em arquivo. O backend continua restrito a loopback no perfil público.

## Compatibilidade e rollback

Não há migration de schema neste item. O schema de `users` e os hashes existentes são reutilizados.

Rollback de código para uma versão anterior, depois de apagar as variáveis, exigiria temporariamente recolocar `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` compatíveis com aquela versão antes de iniciar o serviço antigo. Por isso a remoção do `.env` deve ser feita somente depois da validação da versão nova.

A recuperação local desta versão não deve ser usada com o serviço em execução nem como substituto para backup do SQLite.

## Validação

Antes do merge:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:production
npm run e2e:ci
bash -n scripts/configure-funnel.sh
bash scripts/configure-funnel.test.sh
```

Review sênior deve confirmar:

- nenhuma leitura de `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` no runtime normal;
- login normal de `admin` e `user` pelo SQLite;
- bootstrap inicial continua idempotente;
- recuperação exige serviço parado e não cria conta;
- segredo do gate do Funnel não é persistido nem passado por argv;
- nenhuma regressão de autorização: backend continua sendo a autoridade por `userId`/`role`.
