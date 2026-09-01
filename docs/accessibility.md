# Acessibilidade

Este documento registra a baseline corrente de acessibilidade do Home Music e as regras que novas superfícies devem preservar.

A revisão sistemática foi executada na Fase 11 pela issue #120. O objetivo não é declarar conformidade formal com uma norma específica, e sim tratar teclado, foco, nomes acessíveis, estados e feedback como parte do contrato funcional do produto.

## Escopo revisado

A revisão cobre as principais superfícies mobile, tablet e desktop:

- login e autenticação;
- troca obrigatória de senha;
- Biblioteca, busca, filtros, pastas e playlists;
- Player, progresso, volume e fila;
- downloads offline expostos pela Biblioteca/Player;
- Minha conta;
- Administração e suas superfícies de lista/tabela/workspace;
- dialogs React que participam dos fluxos principais.

A autorização continua sendo responsabilidade do backend. Nenhuma regra de acessibilidade deste documento substitui RBAC, ownership ou as proteções de mutação descritas em `AGENTS.md` e na documentação de segurança.

## Baseline técnica

### Controles nativos primeiro

O frontend deve preferir elementos HTML nativos para interação:

- `button` para ações;
- `input`, `select` e `textarea` para entrada;
- `label` para nomear campos;
- `nav` para grupos de navegação;
- `table` com cabeçalhos semânticos quando os dados são tabulares;
- `dialog` nativo para dialogs modais quando a superfície usa esse padrão.

Não transformar `div`/`span` em controle por `onClick` quando um elemento nativo resolve o mesmo comportamento.

### Foco visível

`apps/web/src/accessibility.css` é a fonte global do indicador de foco por teclado.

Controles focáveis recebem `outline` visível via `:focus-visible`, inclusive campos que usam shells visuais e ranges do player. O token atual `#67b9ff` mantém contraste superior a 8:1 contra as superfícies escuras principais verificadas (`#030507` até `#121820`). Em `forced-colors`, o indicador usa a cor de sistema `Highlight`.

Não remover `outline` sem fornecer um substituto global ou local de contraste equivalente.

### Movimento reduzido

Quando o sistema informa `prefers-reduced-motion: reduce`, animações e transições não essenciais são reduzidas. Estados funcionais continuam descritos por texto/semântica; um spinner nunca deve ser a única indicação de loading.

### Formulários e erros

Campos devem possuir nome acessível por `label` ou equivalente semântico.

Quando um erro pertence a um campo:

- usar `aria-invalid` quando aplicável;
- ligar o campo à explicação com `aria-describedby`;
- manter o diagnóstico visível para usuários que não usam leitor de tela;
- usar `role="alert"` somente para feedback que precisa ser anunciado imediatamente.

No login, falhas de autenticação são associadas aos campos de usuário/senha. Na troca obrigatória de senha, requisitos e divergência de confirmação são associados aos inputs correspondentes.

### Navegação e estado corrente

Estado selecionado/atual não pode depender somente de cor, sublinhado ou ícone.

A navegação da Biblioteca expõe a aba corrente com `aria-current="page"`. A faixa corrente exposta na lista/fila também possui estado programático apropriado, além da indicação visual.

### Player

Os controles principais permanecem botões nativos com nomes acessíveis.

- play/pause possui nome que acompanha a ação;
- shuffle expõe `aria-pressed`;
- repeat expõe nome e `aria-pressed` de acordo com o modo;
- progresso e volume usam `input[type="range"]` com `aria-label`;
- erro de reprodução usa `role="alert"`;
- bloqueio de autoplay usa `role="status"`.

### Fila e reordenação

Drag-and-drop não é o único caminho para reordenar a fila.

Cada item não atual possui botões de mover para cima/baixo, utilizáveis por teclado. Depois da alteração, uma região `role="status"` anuncia a faixa e a nova posição. Touch/drag continuam como atalhos de interação, não como requisito exclusivo.

### Tabelas e listas

Tabelas de Biblioteca/Administração devem preservar cabeçalhos e controles nomeados. Ordenação tabular usa `aria-sort` quando aplicável; checkboxes e ações icon-only precisam de nome acessível específico para o item.

Listas interativas devem continuar usando botões/links nativos para a ação principal e não depender de hover para revelar a única forma de executar uma ação essencial.

### Dialogs e confirmações

Dialogs React existentes que usam `<dialog>` devem preservar:

- título associado por `aria-labelledby` ou nome equivalente;
- fechamento por `Escape` quando a operação permite;
- foco inicial útil;
- retorno ao fluxo sem criar uma segunda fonte de estado.

Confirmações simples ainda usam `window.confirm`/`window.prompt` em alguns fluxos. Esses controles são nativos do navegador e deliberadamente não foram substituídos apenas para esta revisão. Novos dialogs customizados só devem ser introduzidos quando trouxerem comportamento/UX necessário e vierem acompanhados de foco, teclado e testes adequados.

## Regressões automatizadas

### Testes de contrato

`apps/web/src/accessibility.test.ts` fixa invariantes transversais que não podem desaparecer silenciosamente:

- foco visível;
- conteúdo `sr-only`;
- movimento reduzido e forced colors;
- associação de erros de autenticação;
- estado corrente da Biblioteca;
- estado de repeat;
- reordenação da fila com anúncio.

Ele roda dentro da suíte web normal e, portanto, no passo `Tests` do CI.

### Playwright crítico

`e2e/tests/critical-smoke.spec.ts` valida a baseline de foco na Biblioteca usando o estilo efetivamente calculado pelo browser. O mesmo smoke é executado em:

- mobile Chromium — 390×844;
- tablet Chromium — 834×1112;
- desktop Chromium — 1440×900.

O smoke também continua cobrindo deep links, histórico do navegador, preservação do player, Minha conta e Administração.

## Comandos de validação

Durante desenvolvimento, executar primeiro os testes focados. O gate final segue `AGENTS.md`:

```bash
npm run typecheck
npm run test:security
npm test
npm run benchmark:large-library
npm run build
npm run smoke:production
npm --prefix e2e run test:critical
```

Quando a mudança afetar um fluxo fora do smoke crítico, executar também a regressão E2E completa proporcional ao risco.

## Limites conhecidos

A suíte automatizada não equivale a certificação de acessibilidade e não simula todas as combinações reais de tecnologia assistiva.

Limites atuais:

- CI usa Chromium; diferenças específicas de Safari/iOS e leitores de tela nativos precisam de validação real quando forem relevantes para uma entrega;
- VoiceOver, TalkBack, NVDA e outros leitores não são executados como gate automatizado;
- a revisão não declara conformidade integral WCAG de toda a paleta histórica; ela fixa os problemas comprovados e os padrões que novas mudanças devem preservar;
- `window.confirm`/`window.prompt` continuam presentes em fluxos simples e seguem a implementação acessível do navegador/plataforma.

Esses limites não justificam regressão conhecida. Finding reproduzível de teclado, foco, nome acessível, ordem, contraste ou feedback deve ser tratado como bug funcional conforme a severidade definida em `AGENTS.md`.

## Regra para novas mudanças

Antes de concluir uma mudança de UI:

1. percorra o fluxo principal somente por teclado quando houver teclado;
2. confirme foco visível e ordem lógica;
3. confirme nome/estado de controles icon-only e toggles;
4. confirme que erro, loading, seleção e sucesso não dependem só de cor/animação;
5. valide dialogs e retorno de foco quando forem alterados;
6. revise touch targets e ações que aparecem apenas por hover;
7. adicione regressão automatizada quando o comportamento puder ser provado de forma estável;
8. execute o auto code review completo do `AGENTS.md` no head final.
