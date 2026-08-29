# Retry e diagnóstico de jobs de importação

A Fase 9 trata retry como uma **nova tentativa**, nunca como reabertura de um job terminal.

## Princípios

- Jobs `failed`, `completed` e `cancelled` continuam terminais na fila em memória.
- Um retry cria um novo `jobId`.
- Upload cria um workspace novo no staging antes de receber os novos bytes.
- URL inicia uma nova aquisição remota pelo mesmo fluxo SSRF-safe da importação normal.
- Tokens de validação, hashes, metadata editada, fingerprints e arquivos temporários da tentativa anterior não são reutilizados.
- O histórico persiste apenas contexto mínimo e sanitizado. Bytes do upload e a URL original não são armazenados para retry.
- Provider permanece sem retry enquanto a aquisição não for reproduzível de forma explícita.

## Diagnóstico

Falhas de importação são classificadas como:

- `retryable`: falha operacional/transitória em que uma nova aquisição pode resolver o problema, como timeout, indisponibilidade de ferramenta ou falha genérica de I/O;
- `definitive`: conteúdo inválido, política de segurança, limite de tamanho, HTTP permanente ou outra condição que exige corrigir a origem;
- `none`: job sem falha terminal relevante para retry.

O diagnóstico público continua passando pela sanitização do histórico administrativo: URLs, caminhos, tokens, cookies, secrets e credenciais não são expostos.

Por compatibilidade e segurança, falhas antigas existentes antes desta implementação são migradas como `definitive`; somente falhas observadas pelo código novo recebem classificação retryable automaticamente.

## Lineage

O histórico de importação mantém:

- `import_retry_of_id`: operação imediatamente anterior;
- `import_root_id`: primeira operação da cadeia;
- `import_attempt`: número da tentativa, começando em `1`;
- `import_failure_disposition`: diagnóstico `none`, `retryable` ou `definitive`.

A fila carrega lineage somente na tentativa atual quando o fluxo de aquisição suporta isso. O histórico é a fonte persistente da cadeia e sobrevive a restart.

## Concorrência e idempotência

Antes de iniciar uma nova fonte, `prepareImportRetry()` faz um claim atômico no SQLite mudando `can_retry` de `1` para `0` somente se a operação ainda for elegível.

Isso impede duas requisições simultâneas de criarem dois filhos para o mesmo pai.

Se a nova fonte for rejeitada **antes** de um filho ser criado, `releaseImportRetry()` devolve o claim e o admin pode corrigir a entrada. Depois que um filho existe, o pai permanece sem retry; uma tentativa futura deve partir do filho caso ele também falhe de forma recuperável.

## API

`POST /api/admin/operations/:id/retry`

A rota exige o mesmo cabeçalho de mutação das demais ações administrativas.

Para upload, o corpo informa novamente:

```json
{
  "fileName": "faixa.flac",
  "size": 123456
}
```

Depois da criação do novo job, os bytes são enviados pelo endpoint normal de upload para o novo `jobId`.

Para URL, o corpo informa novamente:

```json
{
  "url": "https://exemplo.invalid/faixa.flac"
}
```

A URL anterior não é recuperada do histórico.

## UI administrativa

O Histórico operacional mostra:

- número da tentativa;
- diagnóstico recuperável ou definitivo;
- ação de retry somente quando `canRetry` vier autorizado pelo servidor;
- seletor de novo arquivo para upload;
- campo vazio para digitar novamente a URL.

A tela nunca pré-preenche a URL anterior nem tenta reutilizar um arquivo temporário antigo.
