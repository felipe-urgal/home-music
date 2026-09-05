# AGENTS.md — frontend (`apps/web`)

Estas regras complementam o `AGENTS.md` da raiz para mudanças em `apps/web`.

## Arquitetura e fontes de verdade

Leia `docs/app-composition.md` quando a mudança tocar sessão, conectividade, navegação global ou modo offline.

Fronteiras atuais:

```text
App.tsx
  -> sessão + conectividade + entrada/saída do modo offline

AuthenticatedApp.tsx
  -> composição online autenticada
  -> biblioteca + navegação + player + shells

OfflineApp.tsx
  -> experiência local isolada
  -> biblioteca offline + player offline
```

Preserve as autoridades existentes:

- `App.tsx` decide a transição online/offline; `LoginScreen` não vira controlador paralelo de conectividade;
- `useLibraryData` mantém a biblioteca online canônica consumida pela aplicação autenticada;
- `useAudioPlayer` é a fonte de verdade do playback dentro de cada modo;
- índices, caches e projeções derivados da biblioteca são descartáveis e não substituem o snapshot/revision canônico;
- diferenças mobile/desktop pertencem aos shells/superfícies responsáveis, não à raiz de sessão.

Não introduza store/context global apenas para mover estado de lugar. Extraia estado quando existir ganho concreto de ownership, ciclo de vida ou redução de acoplamento.

## Contratos HTTP

- use tipos de `@home-music/shared` para contratos que atravessam frontend/backend;
- não replique tipos de resposta manualmente se eles pertencem ao pacote compartilhado;
- frontend não é fronteira de autorização: esconder botão/menu é UX, não segurança;
- mutações autenticadas preservam o header da aplicação exigido pelo contrato atual;
- erros exibidos ao usuário devem ser acionáveis sem vazar detalhes internos;
- reconcilie estado após mutações com a fonte canônica; não mantenha sucesso otimista divergente sem estratégia explícita.

Mudança de API deve ser conferida também em `apps/server` e `packages/shared`.

## Estado assíncrono

Proteja interfaces contra respostas obsoletas e corridas:

- descarte resposta de request anterior quando contexto/filtro/seleção mudou;
- loading existe somente enquanto há trabalho real;
- botão desabilitado não deve continuar parecendo ativo/carregando;
- cleanup de timer/listener/request acompanha o ciclo de vida que o criou;
- operações concorrentes não podem sobrescrever silenciosamente estado mais novo;
- estado derivado não deve virar uma segunda fonte de verdade persistente.

Teste pelo comportamento observável, não por detalhe incidental de implementação.

## PWA e offline

Mudanças em service worker, downloads, cache, Background Fetch ou entrada offline exigem leitura de:

- `docs/pwa.md`;
- `docs/offline-downloads.md`;
- `docs/app-composition.md`.

Invariantes importantes:

- conteúdo offline permanece isolado por usuário;
- artefato físico e referência lógica continuam separados;
- uma faixa compartilhada por várias coleções não ganha cópias físicas desnecessárias;
- remoção só coleta bytes quando nenhuma referência do mesmo usuário depende da faixa;
- jobs em voo revalidam a referência antes de publicar disponibilidade;
- service worker não transforma resposta autenticada arbitrária em app-shell cache;
- suporte de API do navegador não deve ser promovido a garantia de plataforma/hardware sem evidência real.

Não altere versões de namespace/capability sem estratégia de migração/compatibilidade correspondente.

## UX e acessibilidade

O Home Music deve permanecer simples, ágil e funcional.

Ao alterar UI, considere conforme a superfície:

- mobile, tablet e desktop;
- teclado, foco visível e ordem de foco;
- labels/nome acessível e estados programáticos;
- contraste e `forced-colors`;
- `prefers-reduced-motion` para animações relevantes;
- touch targets;
- loading, vazio, erro, sucesso e conteúdo longo;
- dialogs e confirmações destrutivas;
- feedback que não dependa somente de cor.

Consulte `docs/accessibility.md` para mudanças transversais de acessibilidade.

Não mude CSS/markup de produção apenas para satisfazer um teste que ignorou a arquitetura responsiva real; corrija o teste quando o comportamento atual estiver correto.

## Administração

- ações administrativas continuam dependendo de autorização server-side;
- separação visual entre ação reversível e permanente deve permanecer clara;
- não envie paths físicos como autoridade para operações de arquivo;
- telas administrativas não reimplementam confinement, duplicate detection, promoção de importação ou outras regras pertencentes ao servidor;
- depois de alteração de metadata/capa/arquivo, reconcilie as superfícies que consomem a projeção efetiva.

Use os documentos `docs/admin-*.md`, `docs/administration-ui.md` e documentos de importação conforme o domínio tocado.

## Performance

Para biblioteca grande:

- preserve `libraryRevision`/identidade do snapshot como chave de invalidação das estruturas derivadas;
- não crie cópias O(n) por render/interação sem necessidade;
- índices devem ser derivados, limitados e reconstruíveis;
- otimização precisa manter equivalência semântica com o caminho canônico.

Mudança com risco de escala deve considerar os benchmarks documentados em `docs/large-library-benchmark.md` e `docs/library-navigation-performance.md`.

## Testes

Testes web vivem próximos ao código e devem proteger comportamento relevante.

Use conforme o risco:

```bash
npm run test -w @home-music/web
npm run typecheck -w @home-music/web
```

O gate raiz continua sendo `npm run check`.

Use Playwright quando o comportamento depender de browser real, integração fullstack, responsividade crítica, PWA/offline ou fluxo que unidade/componente não proteja adequadamente. As regras específicas do runner estão em `e2e/AGENTS.md`.

Não adicione teste apenas para congelar texto, classe CSS ou estrutura incidental sem contrato de produto.
