# Gestão de dependências

Este documento define a política corrente de atualização de dependências do Home Music.

A baseline foi introduzida na Fase 11 pela issue #122. O objetivo é manter dependências e GitHub Actions atualizadas com baixo risco, sem conceder autoridade de merge a uma automação e sem transformar atualização de versão em exceção aos gates normais do repositório.

## Fonte de verdade

A configuração automatizada vive em:

```text
.github/dependabot.yml
```

Os manifestos/lockfiles continuam sendo a fonte de verdade das versões instaladas:

```text
package.json
package-lock.json

e2e/package.json
e2e/package-lock.json
```

O monorepo principal usa npm workspaces e `npm ci` sobre o lockfile da raiz. O Playwright/E2E possui instalação separada e, por isso, recebe uma entrada própria no Dependabot.

## Superfícies monitoradas

O Dependabot revisa semanalmente:

1. npm do monorepo em `/`;
2. npm da suíte Playwright em `/e2e`;
3. GitHub Actions em `/.github/workflows` através do ecossistema `github-actions`.

A agenda é distribuída na segunda-feira de manhã em `America/Sao_Paulo` para evitar que todas as verificações sejam iniciadas exatamente no mesmo instante.

## Patch e minor

Atualizações SemVer `patch` e `minor` podem ser agrupadas para reduzir ruído de PRs.

No monorepo principal, updates de versão são separados entre dependências de produção e desenvolvimento. No E2E e em GitHub Actions, patch/minor usam grupos próprios.

Agrupar não reduz o gate: o PR agrupado deve passar pelo CI completo e ser revisado como um conjunto. Se uma atualização dentro do grupo tornar a análise ambígua ou aumentar demais o blast radius, ela deve ser separada antes do merge.

## Major

Atualizações `major` ficam fora dos grupos patch/minor e, portanto, devem aparecer de forma isolada.

Major nunca é tratada como manutenção rotineira. Antes do merge:

1. ler release notes/changelog e migration guide oficiais;
2. identificar breaking changes e APIs removidas/depreciadas;
3. mapear impacto em runtime, build, testes, produção e dados;
4. adaptar código/configuração explicitamente quando necessário;
5. executar os gates proporcionais ao risco e o CI completo;
6. fazer auto code review no head final conforme `AGENTS.md`.

Se a major não for necessária ou segura naquele momento, o PR pode permanecer aberto/ser fechado com decisão registrada; não alterar testes para acomodar regressão conhecida.

## Atualizações de segurança

O CI continua executando:

```bash
npm audit --audit-level=high
npm audit --prefix e2e --audit-level=high
```

Isso permanece como backstop obrigatório mesmo com Dependabot.

Quando Dependabot Security Updates estiver habilitado nas configurações do repositório, o `dependabot.yml` agrupa correções de segurança patch/minor de npm quando possível. Correção de segurança que exige major/breaking change permanece uma mudança de alto risco e deve seguir análise dedicada.

### Vulnerabilidade sem correção segura imediata

Não usar `ignore` apenas para deixar CI/alerta verde.

Quando uma vulnerabilidade relevante não puder ser corrigida sem regressão ou major incompatível:

- confirmar se a dependência/caminho vulnerável é realmente alcançável no Home Music;
- registrar severidade, superfície afetada e mitigação disponível;
- abrir/manter issue rastreável quando houver risco residual real;
- documentar por que a atualização foi adiada;
- reavaliar quando houver nova versão ou mudança de arquitetura.

Um risco aceito explicitamente não autoriza reduzir o nível do `npm audit` no CI sem decisão separada e justificada.

## Dependências abandonadas ou críticas

Sinais de atenção:

- pacote arquivado/sem manutenção;
- release de segurança sem versão compatível;
- dependência crítica presa em major antiga;
- pacote que exige permissões/processos/rede novos;
- tooling que deixa de suportar a versão de Node adotada pelo projeto.

Nesses casos, a revisão deve decidir entre:

1. atualizar com migration explícita;
2. substituir por alternativa menor/mais mantida;
3. remover a dependência e usar API nativa quando isso simplificar o sistema;
4. manter temporariamente com risco documentado e issue de acompanhamento.

Não adicionar pacote novo apenas para facilitar uma atualização existente.

## GitHub Actions e supply chain

GitHub Actions também são dependências de supply chain.

O workflow atual referencia actions por SHA completo e mantém o número da release em comentário. Essa prática deve ser preservada nas atualizações.

Para PR de Action:

- verificar repositório/origem oficial;
- revisar changelog da release correspondente;
- confirmar que permissões do workflow não foram ampliadas sem necessidade;
- preservar `persist-credentials: false` no checkout salvo decisão explícita em contrário;
- conferir se o SHA pinado corresponde à release pretendida;
- exigir CI verde.

Não substituir pin por SHA por tag mutável somente para facilitar manutenção.

## Lockfiles e reprodutibilidade

Dependabot pode alterar manifesto e lockfile no mesmo PR, mas o fluxo continua exigindo instalação reproduzível:

```bash
npm ci
npm ci --prefix e2e
```

Regras:

- não editar lockfile manualmente para forçar uma resolução;
- não remover lockfile para resolver conflito;
- não executar upgrade silencioso direto em `main`;
- atualização deve chegar por PR revisável;
- qualquer mudança adicional feita depois de CI/review invalida esses gates, conforme `AGENTS.md`.

## Auto-merge

A política do Home Music é **não auto-mergear PRs de dependência**.

A configuração da #122 somente cria/reúne propostas de atualização. Ela não cria workflow de auto-merge, não reduz revisão e não concede ao Dependabot autoridade para alterar `main` sem PR.

Mesmo patch/minor exige:

```text
PR Dependabot
  ↓
CI obrigatório
  ↓
review do impacto
  ↓
auto code review quando a mudança for tratada pelo agente
  ↓
merge explícito
```

Majors, mudanças de segurança complexas e alterações de Actions merecem revisão reforçada.

## Triagem de um PR de dependência

### Patch/minor agrupado

Verificar:

- changelogs relevantes quando houver mudança comportamental;
- lockfile coerente;
- nenhuma dependência inesperada adicionada;
- CI completo verde;
- ausência de regressão funcional/performance/segurança.

### Major

Além do checklist acima:

- migration guide;
- breaking changes;
- configuração removida/depreciada;
- compatibilidade Node/browser;
- impacto em build/deploy/runtime;
- necessidade de testes adicionais.

### GitHub Action

Além do checklist de supply chain:

- permissões `permissions:`;
- inputs novos/alterados;
- mudança de comportamento de checkout/cache/setup;
- compatibilidade com runner/Node usados pela Action.

## Cadência

Configuração inicial:

| Superfície | Cadência | Horário |
| --- | --- | --- |
| npm monorepo `/` | semanal, segunda | 09:00 America/Sao_Paulo |
| npm E2E `/e2e` | semanal, segunda | 09:15 America/Sao_Paulo |
| GitHub Actions | semanal, segunda | 09:30 America/Sao_Paulo |

A cadência pode ser ajustada se houver excesso de ruído ou necessidade operacional, mas não deve ser alterada para esconder updates relevantes.

## O que a automação não faz

A #122 não:

- executa merge automático;
- aplica major silenciosamente;
- altera código para contornar breaking change;
- desativa testes/audit;
- decide aceitar vulnerabilidade;
- substitui review humano/sênior;
- garante que toda nova versão seja apropriada para o produto.

## Gate para mudanças futuras nesta política

Qualquer alteração em `.github/dependabot.yml`, CI ou política de dependências deve revisar:

- reprodutibilidade dos lockfiles;
- agrupamento e risco de blast radius;
- majors isoladas;
- Actions/supply chain;
- tratamento de segurança;
- ausência de auto-merge destrutivo;
- coerência com `AGENTS.md` e os gates atuais do CI.
