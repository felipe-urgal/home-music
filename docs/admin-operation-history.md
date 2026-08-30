# Histórico operacional da Administração

O histórico administrativo persiste scans e importações para que o administrador consiga entender o que aconteceu, quanto tempo levou, qual tentativa está sendo exibida e o que fazer quando uma operação falhar.

## Escopo atual

O histórico registra:

- scans manuais iniciados por `POST /api/library/scan`;
- scans automáticos iniciados pelo scheduler;
- jobs de importação de upload, URL e providers externos;
- transições de estado dos jobs;
- lineage/diagnóstico necessário ao retry quando suportado.

O scan de bootstrap usado apenas para inicializar a biblioteca não é tratado como operação administrativa manual.

## Persistência

A tabela `admin_operation_history` fica no mesmo SQLite do Home Music.

Registros terminais recentes são retidos até o limite configurado pelo store. Operações ainda `pending`/`running` não são podadas durante execução normal.

Ao iniciar o serviço, registros antigos que ficaram não-terminais são encerrados como `cancelled`, com mensagem sanitizada indicando interrupção por restart. A fila em memória correspondente não é fingida como ainda ativa.

Como o histórico está no mesmo SQLite, ele faz parte naturalmente do backup consistente do estado.

## Scans

Existe somente uma `scanPromise` real por vez. Quando um scan efetivamente inicia, o histórico registra:

- trigger manual/automático;
- início/fim;
- duração;
- status;
- total de faixas;
- adicionadas, atualizadas, removidas e inalteradas.

Chamadas concorrentes que reutilizam a mesma operação não criam histórico duplicado.

Falha ao persistir observabilidade não deve alterar o resultado principal do scan.

## Importações

O `ImportJobQueue` continua sendo a autoridade da máquina de estados em runtime. O histórico recebe snapshots defensivos em criação/transições e preserva o estado terminal no SQLite.

Mapeamento para a UI:

```text
pending     → pending
processing  → running
completed   → completed
failed      → failed
cancelled   → cancelled
```

O pipeline atual já cobre upload, URL direta e provider externo, incluindo validação técnica, metadata, duplicatas, promoção e atualização incremental da biblioteca.

O histórico não precisa armazenar bytes do upload nem URL original sensível para ser útil.

## Retry atual

A Fase 9 implementou retry seguro para origens reproduzíveis.

Princípios:

- retry cria **novo `jobId`**;
- job terminal anterior não é reaberto;
- staging/tokens/hashes temporários antigos não são reutilizados;
- upload exige selecionar/enviar novamente o arquivo;
- URL exige informar novamente a URL;
- provider permanece sem retry quando a aquisição não puder ser reproduzida explicitamente;
- `canRetry` é decidido pelo servidor a partir do diagnóstico e do estado persistido.

Lineage persistida inclui tentativa raiz/anterior e número da tentativa. O claim de retry é atômico para impedir dois filhos concorrentes do mesmo pai.

Detalhes: [import-job-retry.md](import-job-retry.md).

## Erros acionáveis e sanitização

O histórico não persiste stack trace nem payload bruto.

Mensagens públicas são sanitizadas para remover/substituir, entre outros:

- URLs completas;
- caminhos absolutos Unix/Windows;
- `authorization`, `cookie`, `password`, `token`, `secret`, `api-key`;
- credenciais `Bearer`.

Rótulos de importação também são sanitizados. Uma URL pode aparecer como `Importação por URL`, não como o endereço completo.

Falhas conhecidas recebem orientação curta, por exemplo:

- fonte indisponível;
- permissão negada;
- SQLite ocupado;
- timeout/rede;
- FFmpeg/codec/formato;
- regra de segurança/entrada inválida.

## API

### `GET /api/admin/operations`

Rota exclusiva de `admin`, `private, no-store`.

Filtros:

- `kind=scan|import`;
- `status=pending|running|completed|failed|cancelled`;
- `limit=1..500`.

### `POST /api/admin/operations/:id/retry`

Disponível apenas quando o servidor considera a operação elegível e exige o mesmo header de mutação das ações administrativas.

O cliente nunca deve inferir retry somente porque vê `failed`.

## Interface

Em **Administração → Histórico operacional**, o administrador pode:

- filtrar por tipo/status;
- atualizar a lista;
- selecionar uma operação;
- ver início, fim e duração;
- ver contagens de scan quando existentes;
- revisar mensagem sanitizada e orientação;
- ver número da tentativa/diagnóstico;
- iniciar nova tentativa quando `canRetry=true`.

Retry de upload pede novo arquivo; retry de URL pede a URL novamente. O histórico não pré-preenche segredo/origem sensível anterior.

## Invariantes

- histórico não é fonte de verdade da operação principal;
- falha de persistência do histórico não deve derrubar scan/importação;
- scans concorrentes reutilizados não geram duplicatas;
- operações abandonadas por restart não permanecem falsamente ativas;
- stack traces/segredos/URLs/caminhos sensíveis não são expostos;
- contagens só aparecem quando realmente existem;
- retry é uma nova tentativa, não retomada de staging antigo;
- somente `admin` consulta e aciona retry administrativo.

## Testes relevantes

A cobertura existente inclui persistência/reabertura, operações interrompidas, filtros, snapshots de importação, retenção, sanitização, autorização e retry/lineage. A expansão E2E mais ampla permanece no backlog da #111.
