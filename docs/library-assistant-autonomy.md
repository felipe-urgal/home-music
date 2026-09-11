# Assistente automático

O modo automático é **opt-in** e nasce desligado. Ele reutiliza o mesmo pipeline incremental de análise e a mesma autoridade de revisão/aplicação do Assistente manual.

## Primeira versão

- dispara somente depois de scan/import que realmente publicou mudança relevante;
- analisa apenas `metadata` usando o índice incremental já existente;
- auto-aplica apenas sugestões `high-confidence`, sem blockers e somente quando o campo atual está vazio;
- capa e lyrics continuam manuais;
- qualquer revalidação stale/override humano continua sendo feita pelo serviço de review existente;
- scans rápidos são coalescidos em uma única revisão pendente;
- falha do Assistente ocorre depois do snapshot da biblioteca e não invalida um scan/import já concluído;
- desligar o modo cancela o run autônomo ativo e limpa trabalho pendente sem afetar o fluxo manual.

## Administração

`GET /api/admin/library-assistant/autonomy` retorna configuração, run ativo, revisão pendente e o último resumo.

`PUT /api/admin/library-assistant/autonomy` aceita:

```json
{
  "enabled": true,
  "metadata": true
}
```

`fillMissingOnly` é fixo em `true` nesta fase. Não há threshold configurável pelo usuário.

## Persistência e reinício

Configuração, run ativo, revisão pendente e último resumo ficam no SQLite. Ao reiniciar, trabalho pendente pode ser retomado; runs do Assistente continuam usando a recuperação existente da fila persistente.

## Limites

Esta fase não auto-aplica artwork, lyrics, aliases globais nem substitui valores já preenchidos. Evoluções dessas capacidades devem passar pela mesma política modular e pela autoridade de review, sem criar pipeline paralelo.
