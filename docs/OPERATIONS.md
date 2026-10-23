# Operações

Este é o runbook canônico para comandos operacionais do Home Music. Ele descreve o
contrato suportado; detalhes de implementação permanecem nos scripts e testes próximos.

## Princípios

- a porta 8787 não deve ser exposta diretamente à Internet;
- operações mutáveis exigem solicitação operacional explícita;
- backup deve preceder mudança de schema quando aplicável;
- restore é uma operação offline e deve preservar possibilidade de rollback;
- status/verificação devem permanecer read-only.

## Produção

Comandos públicos definidos no `package.json`:

```bash
npm run prod:status
npm run prod:check
npm run prod:backup -- <destino>
npm run prod:deploy
npm run prod:verify
npm run prod:logs
```

O Dev Dashboard consome o mesmo contrato em `.dev-dashboard/production.json`.

## Controle de ciclo de vida local (independente de deploy)

Após `npm run service:install`, o instalador publica o helper fixo
`/usr/local/sbin/home-music-service-control` pertencente a root (0755)
e uma regra sudoers NOPASSWD específica para o usuário instalador.
O helper aceita **somente** `check`, `start`, `stop`, `restart`, sempre
sobre `home-music.service`. O Dev Dashboard poderá usá-lo sem atualizar
código, criar build, alterar boot ou executar migrações.

```bash
systemctl is-active home-music.service
sudo -n /usr/local/sbin/home-music-service-control check
sudo -n /usr/local/sbin/home-music-service-control start
sudo -n /usr/local/sbin/home-music-service-control stop
sudo -n /usr/local/sbin/home-music-service-control restart
curl -f http://127.0.0.1:8787/ready
```

**Instalações anteriores** devem executar novamente `npm run service:install`
para atualizar o helper e sua regra sudoers; `service:update` não altera
nenhuma permissão instalada. Esta reinstalação requer privilégios explícitos
e reinicia o serviço; **não** é necessária a cada start/stop.

## Observabilidade de migrations SQLite

Ao abrir a conexão principal, o servidor registra uma linha `SQLite migration:`
em stderr com `status` (`success` ao atualizar o schema, `skipped` se já
estiver atualizado, ou `failed`), `fromVersion`, `toVersion` e
`durationMs` (relógio monotônico). Se a migration falhar, `toVersion=unknown`
não pressupõe que a versão tenha sido confirmada; consulte a causa original
da falha antes de tentar iniciar o serviço novamente. A linha de métricas não
inclui caminho físico do banco, conteúdo das tabelas, hashes ou credenciais.
Ela não substitui backup pré-upgrade nem os testes de integridade.

## Backup e restore

```bash
npm run backup:create -- --output <diretorio>
npm run backup:verify -- --artifact <diretorio.backup>
npm run backup:restore -- --artifact <diretorio.backup> --confirm-service-stopped
```

Os comandos `backup:create`, `backup:verify` e `backup:restore` registram, ao
terminar, `operation`, `status` (`success`, `blocked` ou `failed`),
`schemaVersion` (ou `unknown`) e `durationMs` em stderr. Essas métricas
não incluem caminho do banco, credenciais, hashes nem conteúdo do manifesto;
não substituem logs de erro ou a validação do artefato. Na criação e verificação
do backup, o SQLite deve passar `integrity_check` **e** `foreign_key_check`;
um snapshot com relações órfãs é rejeitado mesmo que SHA-256 e estrutura
física estejam íntegros. Um restore bloqueado não deve ser tratado como
sucesso, mesmo que a verificação inicial tenha passado.

O SQLite principal usa WAL e `synchronous=NORMAL`: essa combinação prioriza
throughput sem dispensar backups verificados e um procedimento de restore
offline. Não alterar para `FULL` sem medir custo e requisito de durabilidade
do ambiente. O restore **não** para serviços automaticamente. Antes de executar o
comando, pare `home-music.service` e quaisquer processos de desenvolvimento
(`npm run dev`/`npm start`) que possam estar com o banco aberto. O parâmetro
`--confirm-service-stopped` é uma confirmação operacional, **não** prova de
que o processo foi encerrado. O CLI verifica o estado de `home-music.service`
quando `systemctl` está disponível: bloqueia o restore se o serviço estiver
ativo **ou** se a consulta falhar por erro de execução ou ultrapassar o limite
de 2 segundos. Apenas exit status `3` (`inactive`/`failed`) é aceito
como serviço não ativo; `1`, `4` e outros códigos inesperados bloqueiam
o restore por estado desconhecido, mesmo com confirmação explícita. A
ausência do comando `systemctl` mantém a confirmação manual obrigatória.

A detecção adicional de descritores SQLite (`db`, `-wal`, `-shm`) usa
`/proc` **somente no Linux**. Se a enumeração principal de `/proc` falhar,
o restore é bloqueado em vez de presumir ausência de processos. Entradas de
processos individuais podem estar inacessíveis por permissão, então a
verificação automática é uma proteção complementar, não substitui a conferência
operacional. Em outras plataformas ou hosts sem `systemctl`, o operador precisa
confirmar manualmente que não há processos usando os arquivos antes do restore.
O guard é reexecutado imediatamente antes da troca de banco. Depois da
verificação inicial do artefato e da confirmação offline, o restore também
reconfere **tamanho e SHA-256 do SQLite preparado** antes de remover os
sidecars do banco atual. Qualquer divergência aborta sem substituir o banco
existente; o snapshot de rollback e os arquivos temporários são limpos.

Restore real não deve ser usado como teste. O smoke seguro é:

```bash
npm run smoke:backup-restore
```

## Scanner e reconciliação da biblioteca

Quando `MUSIC_DIR` aponta para um snapshot SQLite existente, o servidor carrega a
biblioteca sem percorrer todos os arquivos para liberar a aplicação rapidamente.
O status começa como `stale` e, **15 segundos após o listener HTTP iniciar**,
executa uma reconciliação única, inclusive quando
`HOME_MUSIC_RESCAN_INTERVAL_SECONDS=0`. Se o auto-rescan estiver habilitado,
essa verificação inicial faz parte da agenda recorrente, sem duplicar scans.
Alterações encontradas incrementam `revision`; um scan sem mudanças preserva
a revisão. O operador pode solicitar `POST /api/library/scan` a qualquer momento.

`GET /api/library/status` expõe `ready`, `freshness`
(`fresh`, `stale`, `degraded`, `unavailable`), `lastSuccessfulScanAt`,
`lastAttemptAt`, `lastError` sanitizado, `scanning`, `revision`,
`autoRescan` e métricas limitadas do lock de mutação. Se um scan posterior
falha por falta de acesso ao volume, o snapshot confirmado no SQLite é
preservado e o status vira `degraded`; streaming continua validando arquivos
antes de abri-los, portanto a presença no catálogo não garante que um volume
temporariamente inacessível possa ser reproduzido. Um scan bem-sucedido limpa
o estado degradado. Sem snapshot válido, o status permanece indisponível.

O benchmark reproduzível de traversal compara 512 faixas em diretório plano
com 512 faixas num caminho de 18 níveis, mede o scan inicial e a mediana de
três scans sem alterações, e valida confinamento, ordenação e ausência de
reindexação. Execute `npm -w @home-music/server run benchmark:scanner`.
A implementação mantém enumeração sequencial, pois o benchmark não demonstra
que adicionar paralelismo ao traversal melhore a situação sob workloads reais;
apenas stat/metadata são paralelizados com o limite existente de até 8 jobs.

**Identidade de arquivos:** o ID de uma faixa é derivado do caminho relativo
em `MUSIC_DIR`. Mover ou renomear arquivos diretamente pelo filesystem **não
preserva o ID** e um rescan pode tratar isso como remoção + adição, com perda
das referências pessoais associadas ao ID antigo (playlist, favoritos,
histórico etc. devido às FKs). Prefira a operação administrativa de
movimentação, que atualiza o caminho mantendo o ID. Para grandes
reorganizações externas, faça backup antes, revise os logs de faixas removidas
e considere reconciliação manual dos vínculos. Não há correspondência
automática por tamanho/mtime nem fingerprint completo para supor identidade.

## Tailscale

Serve privado é o perfil recomendado. Funnel é exposição pública explícita.

### Inicialização conjunta com o Home Music

Na execução de `npm run service:install`, se o host tiver a unit
`tailscaled.service` instalada, a unit do **Home Music** passa a incluir
`Wants=tailscaled.service` e `After=tailscaled.service`. Assim, um Start
ou Restart do Home Music pelo Dev Dashboard também solicita a inicialização
do daemon Tailscale, sem necessitar de sudo adicional no Dashboard.

A dependência é **opcional**: falhas, ausência ou indisponibilidade do Tailscale
não impedem o Home Music de iniciar localmente. Parar Home Music **não para**
`tailscaled` e não revoga o acesso remoto à máquina. A mudança não configura
Tailscale Serve/Funnel nem autentica o dispositivo na tailnet.
`After` ordena o início, mas não aguarda login nem prontidão HTTPS.

Para manter o acesso remoto independentemente do estado do Home Music,
habilite o daemon uma única vez:

```bash
sudo systemctl enable --now tailscaled
systemctl is-active tailscaled
tailscale status
tailscale serve status
```

Instalações anteriores precisam executar `npm run service:install` após
atualizar o checkout para gerar a nova unit. Isso faz build e reinicia o Home
Music; execute em janela apropriada. `service:update` não substitui a unit.
Se instalar Tailscale depois do Home Music, reexecute `service:install`
para incluir a dependência opcional.



```bash
npm run tailscale:status
npm run tailscale:enable
npm run tailscale:disable
npm run tailscale:public:status
npm run tailscale:public:enable
npm run tailscale:public:disable
npm run tailscale:hardening:status
```

Mudanças nesses fluxos devem manter os testes em `scripts/*.test.sh` verdes.

## Gates

```bash
npm run check
npm run test:security
npm run test:policy
npm run test:ops
npm run smoke:production
```

Escolha gates adicionais conforme o risco. Produção, biblioteca real, hardware e
serviços reais não são fixtures implícitas de validação.
