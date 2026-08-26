# Fase 7.5 — Runbook operacional de identidade e usuários

Este documento é a referência operacional para administrar identidade e acesso no Home Music depois da conclusão do fluxo multiusuário da Fase 7.5.

Os documentos `phase-7.5-*.md` continuam registrando decisões técnicas e invariantes de cada etapa. Este runbook concentra o procedimento cotidiano: bootstrap, criação de usuários, primeiro acesso, troca/reset de senha, desativação, recuperação local e rollback de migration.

## Regras que não devem ser quebradas

- Não existe cadastro público.
- Somente `admin` autenticado cria e gerencia outras contas.
- `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` servem apenas para o primeiro bootstrap, quando `users` ainda está vazio.
- Depois do bootstrap, login de `admin` e `user` usa exclusivamente o hash persistido no SQLite.
- Senhas temporárias são exibidas uma única vez e nunca ficam armazenadas em claro.
- Trocar senha revoga todas as sessões da própria conta, inclusive a atual.
- Alterar role, desativar ou resetar senha de outra conta revoga as sessões dessa conta.
- O backend impede remover/rebaixar o último administrador ativo.
- Operações administrativas sobre a própria conta são bloqueadas; use `Minha conta` para senha e sessões próprias.
- Recuperação de administrador é exclusivamente local e exige o serviço parado.
- Nunca tente fazer downgrade alterando `PRAGMA user_version` manualmente.

## 1. Primeiro bootstrap

O bootstrap existe somente para transformar a instalação antiga em uma instalação com identidade persistida.

Antes do primeiro start de uma instalação sem usuários, configure temporariamente:

```env
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-exclusiva-com-12-ou-mais-caracteres
```

Suba/atualize o serviço normalmente:

```bash
npm run service:update
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Quando `users` está vazio, o preload cria o primeiro usuário como `admin`, persiste somente o hash `scrypt` e mantém o mesmo acesso no login.

O bootstrap é idempotente: se já existe qualquer usuário, editar `HOME_MUSIC_USER` ou `HOME_MUSIC_PASSWORD` não altera a conta persistida.

### Remover as credenciais do `.env`

Depois de implantar uma versão que autentica pelo SQLite:

1. confirme `/ready`;
2. faça login real como admin;
3. remova por completo `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` do `.env`;
4. reinicie o serviço;
5. confirme `/ready` e faça login novamente.

```bash
sudo systemctl restart home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
npm run tailscale:public:status
```

Se o segundo login funcionar, a instalação já não depende das credenciais de bootstrap.

## 2. Criar usuário

Entre como `admin` e abra **Administração · Usuários**.

1. informe o username;
2. escolha `user` ou `admin`;
3. crie a conta;
4. copie a senha temporária exibida;
5. entregue essa senha por um canal apropriado ao usuário;
6. dispense a senha temporária da tela quando não for mais necessária.

A conta nasce:

```text
enabled = true
password_must_change = true
```

O servidor gera uma senha temporária aleatória e persiste somente o hash. A senha em claro não pode ser recuperada depois. Se ela for perdida, faça um reset administrativo e use a nova senha temporária.

## 3. Primeiro acesso com senha temporária

O usuário entra com username + senha temporária.

Enquanto `password_must_change = true`, o backend restringe a sessão ao fluxo mínimo necessário para concluir a troca de senha. O usuário deve escolher uma senha nova antes de acessar normalmente o produto.

Depois da troca:

- `password_must_change` volta para `false`;
- o hash novo é persistido;
- todas as sessões daquela conta são revogadas;
- o usuário autentica novamente com a senha definitiva.

## 4. Trocar a própria senha

Qualquer `admin` ou `user` autenticado pode abrir **Minha conta** e trocar a própria senha.

É necessário informar:

- senha atual;
- nova senha;
- confirmação da nova senha.

A política atual exige no mínimo 12 caracteres Unicode, valor não composto somente por whitespace e limite técnico de 1024 bytes UTF-8.

Uma troca bem-sucedida revoga **todas** as sessões da conta, incluindo a sessão atual. Isso é intencional: depois de alterar a credencial, faça login novamente com a senha nova.

Para encerrar somente outros dispositivos sem trocar a senha, use **Sair dos outros dispositivos** em `Minha conta`; a sessão atual é preservada.

## 5. Resetar a senha de outro usuário

Entre como `admin`, abra **Administração · Usuários** e use o reset de senha na conta alvo.

O servidor:

- gera uma nova senha temporária;
- substitui o hash antigo;
- define `password_must_change = true`;
- revoga todas as sessões do usuário alvo;
- retorna a senha temporária somente naquela resposta.

A conta alvo deverá fazer login com a senha temporária e definir uma senha nova.

O admin não usa esse fluxo para a própria conta. Para a própria senha, use `Minha conta`; para perda total de acesso administrativo, use a recuperação local descrita abaixo.

## 6. Desativar e reativar conta

Em **Administração · Usuários**, um admin pode desativar outra conta.

Ao desativar:

- `enabled` passa para `false`;
- as sessões do alvo são revogadas;
- novos requests daquela identidade deixam de ser autorizados;
- login posterior é recusado enquanto a conta estiver desativada.

Ao reativar, o usuário volta a poder autenticar com a credencial atualmente persistida. Se a senha não for conhecida ou precisar ser rotacionada, faça também um reset administrativo.

Proteções importantes:

- um admin não pode desativar a própria conta pela API administrativa;
- um admin não pode rebaixar a própria role pela API administrativa;
- o servidor rejeita qualquer operação que deixaria zero administradores ativos.

## 7. Alterar role

A role pode ser `admin` ou `user`.

Mudar a role de outra conta revoga as sessões dela. O usuário deverá autenticar novamente e passará a receber as superfícies e permissões correspondentes à role persistida.

A checagem visual do frontend é somente UX; a autorização real continua no backend em cada request.

## 8. Recuperar acesso administrativo localmente

Use este fluxo somente quando não houver acesso administrativo utilizável pela interface.

A recuperação não é uma API HTTP e não cria uma conta escondida. Ela atua somente sobre um username já existente.

Pare o serviço:

```bash
sudo systemctl stop home-music
```

Execute:

```bash
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
```

O CLI também verifica que `home-music.service` está realmente parado. Em caso de sucesso ele:

- preserva o mesmo `userId`;
- reativa a conta;
- promove a conta para `admin`;
- gera senha temporária aleatória;
- persiste somente o novo hash;
- define `password_must_change = true`;
- exibe a senha temporária uma única vez no terminal.

Depois:

```bash
sudo systemctl start home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Entre com a senha temporária e conclua imediatamente a troca obrigatória.

A recuperação deliberadamente não aceita uma senha escolhida em argumento de linha de comando, evitando colocar segredo no histórico do shell.

## 9. Backup antes de migration

As migrations da Fase 7.5 são automáticas no startup e elevam `PRAGMA user_version` até o schema suportado pela versão em execução.

Antes de implantar uma versão que introduza uma nova migration de dados, faça um backup com o serviço **parado**. Isso garante que não há escrita concorrente e que os arquivos SQLite/WAL pertencem a um estado fechado da aplicação.

Exemplo:

```bash
sudo systemctl stop home-music
BACKUP_DIR="$HOME/home-music-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a data/home-music.db* "$BACKUP_DIR/"
sudo systemctl start home-music
```

Guarde também o SHA/versão do código correspondente ao backup:

```bash
git rev-parse HEAD
```

Não inclua senhas em claro no backup operacional. O `.env` deve ser tratado separadamente como configuração sensível e nunca versionado no Git.

## 10. O que acontece quando uma migration falha

As migrations de identidade/ownership da Fase 7.5 (`v6` a `v10`) protegem as transformações críticas com transação `BEGIN IMMEDIATE`.

Se uma dessas transformações falhar antes do `COMMIT`, o servidor executa `ROLLBACK` e o startup falha em vez de continuar com um schema parcialmente migrado.

Nesse cenário:

1. não altere `PRAGMA user_version` manualmente;
2. mantenha o serviço parado se o startup estiver falhando repetidamente;
3. inspecione o erro no journal;
4. corrija a causa ou volte o código para uma versão compatível com o banco ainda não migrado;
5. só restaure backup se houver necessidade real de retornar o conjunto de dados ao estado anterior.

```bash
journalctl -u home-music -n 200 --no-pager
```

## 11. Rollback depois de uma migration concluída

O Home Music **não possui migrations reversas automáticas**. Depois que uma migration conclui e o `user_version` avança, não faça downgrade apenas trocando o código ou reduzindo o `user_version`.

Para voltar a uma versão de código cujo schema é anterior, o caminho seguro é restaurar um backup criado **antes** da migration.

Procedimento geral:

```bash
sudo systemctl stop home-music
```

1. preserve uma cópia do banco atual para investigação;
2. remova/mova os arquivos atuais `data/home-music.db`, `data/home-music.db-wal` e `data/home-music.db-shm`, se existirem;
3. restaure `home-music.db*` do backup pré-migration;
4. restaure/use a versão de código que corresponde àquele backup;
5. reinstale/build o código dessa versão;
6. inicie o serviço;
7. valide readiness, login e os dados pessoais principais.

Validação mínima depois do restore:

```bash
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Depois confirme manualmente:

- login do administrador;
- favoritos;
- histórico/estatísticas;
- playlists manuais;
- estado do player;
- usuários/roles quando existirem naquele schema.

Se a versão antiga ainda dependia de `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD`, essas variáveis precisam ser temporariamente restauradas antes de iniciar esse código antigo. Não invente novas credenciais: use somente um conjunto compatível com o backup/versão que está sendo restaurado.

## 12. Checklist de operação segura

Antes de uma mudança de identidade/migration:

- saber qual commit está em produção;
- ter backup pré-migration quando houver mudança de schema/dados;
- manter pelo menos um admin ativo;
- não colocar senha em shell history, URL, Git ou logs.

Depois da mudança:

- `npm run service:status` verde;
- `/ready` retorna `200`;
- login de admin funciona;
- login de `user` normal funciona quando aplicável;
- usuário desativado não entra;
- troca/reset de senha invalida sessões como esperado;
- Tailscale Serve/Funnel permanece no perfil esperado.

## Referências técnicas

- `phase-7.5-bootstrap.md` — criação idempotente do primeiro admin;
- `phase-7.5-admin-users-api.md` — contratos e invariantes da administração de usuários;
- `phase-7.5-admin-users-screen.md` — UX de gestão de contas;
- `phase-7.5-required-password-change.md` — primeiro acesso com senha temporária;
- `phase-7.5-self-service-account.md` e `phase-7.5-my-account-screen.md` — senha e sessões próprias;
- `phase-7.5-remove-env-auth-recovery.md` — retirada das credenciais do `.env` e recuperação local;
- `phase-7.5-favorites-ownership.md`, `phase-7.5-history-ownership.md`, `phase-7.5-manual-playlist-ownership.md` e `phase-7.5-playback-state-ownership.md` — migrations de ownership;
- `production.md` — serviço, update, health/readiness e operação em Ubuntu.
