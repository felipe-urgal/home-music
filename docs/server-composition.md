# Composição do servidor

Este documento descreve as fronteiras correntes do processo Fastify depois das refatorações da Fase 11 (#116 e #117).

## Objetivo

`apps/server/src/index.ts` é o **composition root** do backend. Ele pode:

- carregar configuração de ambiente;
- criar a instância Fastify;
- construir e conectar dependências;
- instalar políticas e registrar módulos de rota;
- coordenar startup, shutdown, auto-rescan e `listen`.

Ele não deve implementar regras de domínio, acesso direto à biblioteca, manipulação de mídia ou handlers HTTP de `/api/*`.

## Camadas

```text
index.ts
  ↓ wiring
routes / route composition
  ↓ contratos explícitos
services
  ↓
infrastructure / stores / managers
```

A separação é pragmática, sem framework de DI ou container global.

### Routes

Handlers Fastify ficam agrupados por domínio:

- `auth-routes.ts` — status/login/logout/troca de senha e composição das rotas pessoais de sessão;
- `library-routes.ts` — snapshot/status/rescan, overview e integridade da biblioteca;
- `personal-routes.ts` — favoritos, playlists manuais, estado do player, views pessoais, smart playlists e histórico de playback;
- `media-routes.ts` — lyrics, capa, streaming direto e transcoding;
- `system-routes.ts` — liveness/readiness/diagnóstico e fallback do frontend de produção;
- módulos administrativos continuam separados por domínio (`admin-*-routes.ts`).

Rotas traduzem HTTP para chamadas de serviço/infraestrutura: validam identidade e detalhes específicos da API, escolhem status codes/headers e preservam mensagens de erro externas. Elas não acessam SQLite diretamente quando a regra pertence a um serviço extraído e não executam diretamente primitivas destrutivas de filesystem.

A composição da importação fica em `admin-import-service-routes.ts`. O entrypoint histórico `admin-import-routes.ts` permanece como façade para não alterar imports internos nem testes existentes.

### Services

`library-service.ts` é dono do estado e das regras de ciclo de vida da biblioteca em memória:

- snapshot de faixas;
- filtro de disponibilidade;
- revisão e `scannedAt`;
- scan manual/automático;
- lock de mutações da biblioteca;
- auditoria de integridade;
- reconciliação incremental após promoção de importação;
- fallback para rescan completo quando a indexação incremental falha.

`personal-library-service.ts` concentra regras de dados pessoais que antes estavam nos handlers:

- favoritos e validação da faixa disponível;
- criação, renomeação, remoção e conteúdo de playlists manuais;
- rejeição de mutações em playlists importadas somente leitura;
- validação, normalização e persistência do estado/fila do player.

`admin-track-mutation-service.ts` é a fronteira explícita para operações físicas administrativas de maior risco:

- movimentação/renomeação física de faixas;
- envio para quarentena;
- restauração da quarentena;
- exclusão permanente com confirmação explícita;
- compensação da disponibilidade pública quando uma operação falha;
- normalização de erros operacionais para mensagens públicas sanitizadas.

O serviço **não substitui** `MediaFileMoveStore` nem `MediaQuarantineStore`. Essas primitivas continuam donas de confinement, no-clobber, validação de symlink/arquivo regular, lock compartilhado e rollback de filesystem/SQLite.

`admin-import-service.ts` é o orquestrador único do pipeline administrativo de importação:

- upload, URL e provider externo;
- retry;
- validação técnica;
- preview de metadata;
- detecção/revisão de duplicatas;
- planejamento de destino;
- promoção segura;
- coordenação do fluxo automático e limpeza do estado derivado em cancelamentos.

Ele reutiliza os managers existentes. Não existe um segundo pipeline: staging, validação, metadata, duplicatas, destino seguro, promoção e indexação incremental continuam pertencendo às mesmas primitivas já testadas.

`backup-service.ts` cria a fronteira operacional entre o CLI e `backup-restore.ts`:

- criação e verificação usam as primitivas existentes;
- restore exige guarda offline antes de avançar;
- a guarda é repetida imediatamente antes da troca do SQLite por meio de `beforeReplace`;
- validação do artefato, snapshot de rollback e compensação continuam em `backup-restore.ts`.

Esses serviços não conhecem `FastifyInstance` nem registram endpoints. O objetivo é deixar regras de orquestração testáveis e impedir que handlers/CLI cresçam novamente como donos de invariantes críticas.

### Infrastructure

`server-infrastructure.ts` constrói recursos compartilhados de processo:

- SQLite e stores associados;
- sessões e serviços de credenciais/admin usuários;
- histórico operacional;
- fila de importação;
- rate limiter de login;
- manager e manutenção do cache de transcoding.

Também centraliza o fechamento desses recursos no shutdown.

`track-media-infrastructure.ts` encapsula detalhes de acesso à mídia:

- abertura segura dentro de `MUSIC_DIR`;
- cache de capas e limite de concorrência;
- leitura de lyrics;
- preparação de transcoding e acesso ao arquivo derivado.

Confinement, arquivos regulares e erros de path continuam delegados às primitivas de segurança existentes.

## Autenticação e autorização

`auth-policy.ts` continua sendo a fronteira central e **fail-closed** da API.

O `index.ts` instala `installApiAuthPolicy(...)` uma única vez antes de registrar os domínios. Os módulos de rota não instalam políticas paralelas.

A classificação continua sendo:

```text
public
  ↓
authenticated
  ↓
admin
```

`/api/admin/*` e as operações administrativas legadas continuam classificadas centralmente, independentemente do arquivo em que o handler está registrado. A extração da #117 não altera RBAC, anti-CSRF nem ownership.

## Estado compartilhado

Não existe um segundo snapshot da biblioteca, um segundo owner do transcoding nem uma segunda fila/pipeline de importação:

- `LibraryService` possui o snapshot canônico em memória;
- `PersonalLibraryService` consulta esse mesmo snapshot para validar IDs de faixas;
- `ServerInfrastructure` possui os stores/managers compartilhados;
- `TrackMediaInfrastructure` recebe esses objetos por referência;
- `AdminImportService` recebe a mesma fila e os mesmos managers já compostos para as rotas;
- `AdminTrackMutationService` coordena os stores físicos existentes em vez de reimplementar suas garantias;
- módulos de rota recebem apenas as dependências necessárias.

Esse desenho evita sincronização entre stores paralelos e ciclos de dependência.

## Lifecycle

O composition root continua responsável por ordem operacional:

1. carregar `.env` e configuração;
2. criar Fastify;
3. construir infraestrutura e serviços;
4. instalar auth policy e registrar rotas;
5. preparar frontend em produção;
6. carregar o snapshot da biblioteca;
7. sondar FFmpeg;
8. iniciar Fastify;
9. habilitar auto-rescan quando configurado.

No shutdown:

1. o scheduler automático é parado;
2. um scan em andamento é aguardado antes de fechar SQLite;
3. `app.close()` executa hooks dos módulos, inclusive cleanup da importação e fechamento dos stores administrativos;
4. a infraestrutura compartilhada é fechada.

## Invariantes

Mudanças futuras devem preservar:

- nenhum contrato HTTP muda apenas porque um handler mudou de arquivo;
- auth permanece central e fail-closed;
- `index.ts` não volta a implementar `/api/*` diretamente;
- rotas pessoais não voltam a acessar SQLite diretamente para regras já extraídas;
- handlers administrativos não voltam a executar diretamente movimentação, quarentena ou delete físico;
- imports não ganham um segundo pipeline ou um segundo owner de jobs;
- backup/restore mantém validação prévia, guarda offline imediatamente antes da troca e rollback protegido;
- filesystem e transcoding não vazam para handlers além das interfaces de infraestrutura/serviço;
- estado da biblioteca permanece em uma fonte única;
- shutdown nunca fecha SQLite enquanto um scan conhecido ainda está ativo.

`server-composition.test.ts` protege essas fronteiras estruturais, enquanto as suítes unitárias existentes dos stores/managers, os testes de rotas, o smoke de backup/restore, o Playwright crítico e o production smoke protegem equivalência comportamental.
