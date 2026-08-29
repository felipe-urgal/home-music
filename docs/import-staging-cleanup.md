# Cleanup do staging de importações

A Fase 9 mantém o staging fora de `MUSIC_DIR` e remove workspaces temporários sem seguir symlinks ou tocar na biblioteca definitiva.

## Lifecycle normal

O `ImportStagingManager` já executa cleanup nos caminhos terminais do pipeline:

- **sucesso:** depois da promoção validada, o payload é removido do staging e o workspace é descartado;
- **falha:** falhas de escrita, inspeção, validação ou promoção removem o workspace quando a operação ainda não foi commitada;
- **cancelamento:** uploads e importações por URL chamam o cleanup do workspace antes de finalizar o job;
- **idempotência:** `cleanupJob()` pode ser chamado novamente depois da remoção e retorna `false` sem lançar erro.

## Crash e restart

Workspaces usam nomes gerados pelo servidor com prefixo `job-`. Um restart perde o registro em memória dos jobs ativos do processo anterior, por isso a inicialização executa uma varredura defensiva do diretório de staging.

A varredura:

1. resolve novamente as raízes reais de staging e `MUSIC_DIR`;
2. confirma que as duas raízes continuam disjuntas;
3. considera apenas entradas diretas com prefixo `job-`;
4. ignora explicitamente os workspaces ativos do processo atual;
5. calcula a atividade mais recente entre o diretório e seus arquivos diretos;
6. remove somente órfãos cuja idade atingiu o TTL;
7. remove symlinks como links, sem seguir o destino;
8. registra resumo e falhas em logs estruturados.

Entradas que não pertencem ao padrão `job-*` são ignoradas.

## TTL

O TTL padrão é de **24 horas** e pode ser alterado por:

```text
HOME_MUSIC_IMPORT_STAGING_TTL_HOURS=24
```

Valores aceitos: inteiros entre **1 e 720 horas**. Configuração inválida usa o padrão e gera warning estruturado.

A varredura roda no startup e depois uma vez por hora. O timer usa `unref`, portanto não mantém o processo vivo durante shutdown.

## Proteção de jobs ativos

TTL nunca autoriza remover um workspace ainda registrado como ativo no `ImportStagingManager`. O cleanup recebe um snapshot defensivo contendo somente:

- raiz real do staging;
- raiz real de `MUSIC_DIR`;
- `jobId` e diretório dos workspaces ativos.

Tokens de validação, hashes e caminhos de payload não são expostos ao cleanup.

## Confinamento

O cleanup nunca usa caminhos fornecidos pelo usuário. Candidatos vêm exclusivamente de `readdir(stagingRoot)` e são validados como descendentes da raiz real de staging antes da remoção.

Diretórios são conferidos com `lstat`/`realpath`; symlinks não são seguidos. A raiz de `MUSIC_DIR` é carregada no mesmo snapshot e qualquer candidato que pudesse resolver para a biblioteca é recusado.

## Logs

Os logs usam `component: "import-staging-cleanup"` e registram o motivo da varredura (`startup`, `interval` ou `manual`), TTL e contadores de:

- itens examinados;
- órfãos removidos;
- workspaces ativos preservados;
- órfãos ainda dentro do TTL;
- entradas ignoradas;
- falhas de cleanup.

## Gate da #101

Os testes cobrem cleanup idempotente, workspace ativo antigo, crash/restart, TTL baseado em atividade real, symlink externo, staging parcial, entradas estrangeiras e preservação explícita de arquivos em `MUSIC_DIR`.
