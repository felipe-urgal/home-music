# Arquitetura de providers externos

Esta etapa implementa a fronteira genérica definida pela #96. Ela **não integra yt-dlp nem qualquer site específico**. A decisão da #95 permanece: primeiro estabilizar o contrato e o isolamento; somente depois adicionar um adapter concreto.

## Objetivos

A arquitetura separa cinco responsabilidades:

1. **provider** reconhece a entrada e prepara uma mídia candidata;
2. **scratch do provider** é a única área de filesystem entregue ao provider;
3. **core do Home Music** reabre a saída como arquivo regular seguro;
4. **ImportStagingManager** recebe os bytes copiados pelo core;
5. validação técnica, perfil de saída e promoção continuam nas etapas posteriores do pipeline.

Nenhum provider recebe caminho de `MUSIC_DIR` e nenhum provider escreve diretamente no payload gerenciado pelo staging.

## Fluxo

```text
URL transitória
   |
   v
ExternalProvider.validate()
   |
   v
ImportJob: provider / processing
   |
   +--> staging seguro criado pelo core
   |
   +--> provider scratch 0700, fora de MUSIC_DIR
          |
          v
      ExternalProvider.prepare()
          |
          +--> arquivo candidato
          +--> metadata sugerida
          |
          v
      core abre arquivo com O_NOFOLLOW + /proc/self/fd
          |
          v
      stream controlado + limite de bytes
          |
          v
      ImportStagingManager.writePayload()
          |
          v
      scratch removido
          |
          v
ImportJob: pending
```

`pending` significa apenas que a aquisição do provider terminou e o payload está sob controle do staging. A validação com FFmpeg/ffprobe, decisão de formato e promoção não pertencem à #96; são responsabilidade da #97 e das etapas seguintes.

## Contrato `ExternalProvider`

Cada provider declara:

- `id` estável e normalizado;
- `label` para diagnóstico/UI;
- `capabilities` (`audio`, `metadata`, `thumbnail`, `playlists`);
- opcionalmente, nomes das configurações obrigatórias;
- `validate(request)`, para reconhecer/rejeitar a entrada;
- `prepare(request, context)`, para produzir um arquivo no scratch e metadata sugerida.

O contexto contém somente:

- `scratchDir` do job;
- `AbortSignal` para timeout/cancelamento;
- cópia congelada da configuração daquele provider.

O provider não recebe fila, staging, banco, sessão HTTP nem `MUSIC_DIR`.

### Regra para `validate`

`validate()` deve ser uma validação local e barata da forma/host/capability da URL. Ela **não deve fazer requests de rede**. A policy de egress de um provider real é outra camada e precisa cobrir todas as conexões originadas pelo processo externo.

## Registro e capabilities

`ExternalProviderImportManager` recebe os providers na composição da aplicação e rejeita IDs duplicados. A listagem pública devolve somente:

- ID;
- label;
- capabilities;
- booleano `configured`.

Valores de configuração nunca são retornados pela listagem.

O core continua funcional com zero providers concretos registrados. Isso preserva a independência do pipeline em relação a qualquer site ou engine.

## Entrada e privacidade

Antes de criar um job, o manager exige:

- URL `http:` ou `https:`;
- tamanho limitado;
- nenhuma credencial embutida;
- validação específica do provider.

A URL completa é transitória. O job usa um label fixo por provider e não persiste hostname, path, query string ou fragmento. Isso evita armazenar tokens de URLs assinadas por acidente.

## Scratch do provider

`ExternalProviderScratchManager` cria um workspace privado por job com modo `0700`.

Regras:

- raiz de scratch deve ser disjunta de `MUSIC_DIR` antes mesmo de ser criada;
- raiz existente não pode ser symlink;
- saída deve ser caminho relativo sem traversal;
- o core só aceita arquivo regular cuja resolução final continue dentro do workspace;
- abertura usa a infraestrutura de segurança existente (`O_NOFOLLOW` e revalidação via `/proc/self/fd`);
- scratch é removido após transferência ou em falha/cancelamento.

O subprocesso futuro deve escrever **somente** nesse scratch.

## Transferência para staging

O arquivo retornado pelo provider nunca é promovido ou movido diretamente.

O core:

1. abre a saída segura;
2. verifica tamanho inicial;
3. lê o descritor já validado;
4. aplica limite de bytes durante o stream;
5. entrega chunks para `ImportStagingManager.writePayload()`;
6. registra o tamanho efetivamente escrito;
7. verifica se tamanho/mtime da origem mudaram durante a cópia;
8. elimina o scratch.

Depois disso, apenas o payload do staging participa das etapas seguintes.

## Metadata

Metadata de provider é somente uma sugestão não confiável. O manager normaliza e limita strings antes de mantê-las no resultado preparado:

- `sourceId`;
- `title`;
- `artist`;
- `album`;
- `thumbnailUrl`;
- `contentType`.

Esses valores nunca são usados como comandos ou paths. A #97 e etapas posteriores continuam responsáveis por validar a mídia real.

## Configuração por provider

Um provider pode declarar `requiredConfigKeys`. O manager informa apenas se a configuração está completa.

A configuração entregue ao provider é uma cópia congelada e não é incluída em:

- `ImportJob`;
- descriptors;
- erros públicos;
- metadata preparada.

Suporte futuro a cookies, credenciais ou tokens exige desenho próprio de storage e não deve ser implementado como flags arbitrárias de CLI.

## Estados da fila

- `processing`: provider está validando/preparando/transferring a saída;
- `pending`: payload foi transferido para staging e aguarda a próxima etapa;
- `failed`: setup, timeout, saída insegura/inválida, limite ou falha do adapter;
- `cancelled`: cancelamento solicitado e recursos temporários limpos.

Erros internos são canonicalizados. `stderr`, stack trace, paths internos e mensagens arbitrárias do adapter não são copiados diretamente para a fila/UI.

## Timeout e cancelamento

O runner cria um `AbortController` por execução e aplica timeout global, incluindo preparação e cópia.

Todo provider deve observar `context.signal`. Para providers baseados em subprocesso, observar o sinal significa **encerrar a árvore de processos**, não apenas rejeitar uma Promise no Node.

Um adapter concreto deve garantir que não continue escrevendo/recriando scratch depois de timeout ou cancelamento. Essa garantia pertence ao adapter/runner de subprocesso futuro e precisa de testes próprios.

## Gate de rede para provider real

A #95 identificou uma diferença fundamental entre URL direta (#94) e engines externas: uma engine como yt-dlp pode fazer requests secundários para redirects, manifests, APIs, players e CDNs.

Logo, validar somente a URL inicial não protege contra SSRF.

Antes de habilitar um provider real, é obrigatório ter uma **policy de egress testável** que impeça o processo e auxiliares de alcançar:

- loopback;
- redes privadas;
- link-local;
- endpoints de metadata;
- demais faixas bloqueadas pela política do Home Music.

Se um proxy de saída não cobrir toda a árvore de processos, o isolamento deve acontecer no nível de processo/OS/rede. A infraestrutura genérica desta issue não finge resolver esse problema e, por isso, não registra yt-dlp ainda.

## Testes

`external-provider.test.ts` usa provider fake e não depende de internet. A suíte cobre:

- registry e capabilities;
- configuração obrigatória sem vazamento de segredo;
- validação antes da criação do job;
- ausência da URL original na fila;
- scratch separado de `MUSIC_DIR`;
- transferência scratch → staging;
- path traversal e symlink;
- limite de bytes;
- timeout;
- cancelamento ativo e de payload já pendente;
- snapshots defensivos;
- canonicalização de erros sensíveis.

O CI do core não deve depender de sites externos. Testes reais de engine, quando existirem, devem ser isolados/opcionais.

## Relação com as próximas etapas

- **#95:** escolheu yt-dlp como engine recomendada e definiu os riscos/gates.
- **#96:** cria o contrato genérico, scratch, runner e fake provider.
- **#97:** valida tecnicamente a mídia e decide perfil/formato com FFmpeg/ffprobe.
- provider yt-dlp concreto: somente após a fronteira de egress estar implementada e testada.
