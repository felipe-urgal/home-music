# AGENTS.md — scripts operacionais (`scripts`)

Estas regras complementam o `AGENTS.md` da raiz para mudanças em `scripts`.

`script` neste diretório pode ser parte da fronteira de produção mesmo quando não altera TypeScript da aplicação. Trate shell, smoke e policy como código de produção/teste com risco próprio.

## Fontes canônicas

Conforme o tema, leia:

- `docs/PRODUCTION.md` — sequência operacional suportada;
- `docs/production.md` — systemd/helper privilegiado;
- `docs/production-contract.md` — contrato `prod:*` consumido por automação;
- `.dev-dashboard/production.json` — manifesto executável do Dev Dashboard;
- `docs/tailscale.md`, `docs/public-access.md`, `docs/tailscale-hardening.md` — exposição/acesso;
- `docs/backup-restore.md` — recovery;
- `docs/testing-and-quality.md` — seleção de gates.

Se comando/semântica pública mudar, mantenha `package.json`, manifesto e documentação canônica coerentes na mesma entrega.

## Regra de produção

Sem solicitação operacional explícita do usuário, não execute scripts que mutem a instalação real.

Isso inclui, entre outros:

- `service:install` / `service:update` / `prod:deploy`;
- `systemctl` mutável;
- restore real;
- enable/disable de Tailscale Serve/Funnel;
- instalação/alteração de helper privilegiado;
- edição de `.env`, unit ou permissões reais do host.

Testar script operacional deve preferir fixtures, inspeção, doubles de comandos e testes shell existentes. Não use a máquina de produção como fixture.

## Shell e privilégios

- use `set -euo pipefail` quando compatível com o script e trate exceções deliberadamente;
- cite variáveis e paths corretamente;
- valide inputs antes de usá-los em comandos privilegiados;
- evite `eval`, shell construído por concatenação e expansão não controlada;
- use arrays/argumentos explícitos quando necessário para preservar fronteiras;
- comandos root/helper devem permanecer em catálogo fechado; não introduza passagem arbitrária de `systemctl`/shell por interface externa;
- arquivos sensíveis preservam owner/permissões restritas;
- falha parcial deve ser detectável e, quando possível, compensada ou deixar instrução clara de recovery;
- scripts de update precisam continuar seguros diante de restart/falha entre etapas.

Não amplie privilégio apenas para simplificar automação.

## Systemd

Mudanças em `install-systemd.sh` ou contrato equivalente devem preservar, conforme aplicável:

- distinção entre bootstrap `install` e atualização normal `update`;
- validação de paths/configuração antes da mutação;
- build/dependências executados como usuário apropriado;
- helper privilegiado root-owned e restrito;
- stop/start/reload somente nas transições previstas;
- hardening do unit;
- confirmação de estado final;
- compatibilidade com o contrato `prod:*`.

Não transforme `service:install` em etapa automática de todo deploy.

## Tailscale

Serve privado é o perfil recomendado; Funnel é exposição pública explícita.

Mudanças de Tailscale devem:

- preservar separação entre status read-only e enable/disable mutável;
- validar pré-condições antes de alterar perfil;
- não tornar Funnel público por efeito colateral;
- preservar hardening e bind esperado do backend;
- manter mensagens de diagnóstico sem vazar segredo/token;
- continuar testáveis sem depender de tailnet real.

## Smoke e verificação

Smokes devem provar contrato sem introduzir mutação destrutiva inesperada.

- timeouts/retries são limitados;
- URLs/diagnósticos sensíveis são sanitizados;
- redirect/protocolo não suportado falha de forma explícita quando o contrato exigir;
- smoke de produção não substitui backup/recovery;
- verificação read-only não deve reiniciar serviço ou repetir deploy.

## Política de dependências

Testes de policy protegem configuração, supply chain e lifecycle. Mudança em Dependabot, scripts de lifecycle ou Actions deve considerar:

- lockfile e `npm ci`;
- actions pinadas conforme política existente;
- ausência de auto-merge implícito;
- scripts de instalação que não ganhem efeito colateral privilegiado inesperado.

O workflow semanal/manual de audit é separado do CI normal de PR.

## Testes

Para alterações nos contratos shell de systemd/Tailscale:

```bash
npm run test:ops
```

Para política de dependências/lifecycle:

```bash
npm run test:policy
```

Para mudanças nos smokes/produção, execute o smoke correspondente quando puder fazê-lo em ambiente seguro e descartável.

O gate raiz continua sendo `npm run check`. Registre qualquer validação operacional não executada; não declare operação real apenas por inspeção estática.
