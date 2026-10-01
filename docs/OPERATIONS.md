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
