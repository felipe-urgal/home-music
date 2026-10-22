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

## Backup e restore

```bash
npm run backup:create -- <destino>
npm run backup:verify -- <artefato>
npm run backup:restore -- <artefato>
```

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
