# Lixeira e quarentena administrativa

A Lixeira é a fronteira de segurança entre **remover uma faixa da biblioteca ativa** e **apagar o arquivo físico permanentemente**.

## Princípio

A operação padrão deve ser reversível:

```text
biblioteca ativa
   ↓
enviar para lixeira
   ↓
quarentena
   ├── restaurar
   └── excluir permanentemente (confirmação explícita)
```

Arquivos em quarentena não são reproduzidos nem indexados como parte da biblioteca normal.

## Operações

### Restaurar

Restaura o arquivo para o fluxo normal da biblioteca usando a primitiva segura do backend.

É a ação recomendada quando existe dúvida.

### Excluir permanentemente

Apaga o arquivo físico e não pode ser desfeito pela aplicação.

A exclusão individual exige confirmação explícita. A exclusão em lote exige digitar:

```text
EXCLUIR PERMANENTEMENTE
```

O frontend não implementa `unlink` nem valida paths por conta própria; o backend continua responsável por confinement, lock e invariantes de filesystem.

## Layout atual — PR #181

A superfície usa **lista ampla + inspetor lateral**.

### Lista

Mostra:

- checkbox de seleção;
- título;
- artista/álbum;
- caminho original;
- data em que o item foi movido para a lixeira;
- acesso ao inspetor.

Ações destrutivas não ficam repetidas em cada linha.

### Inspetor

Ao abrir um item, o painel contextual mostra:

- identidade da faixa;
- caminho original;
- data da quarentena;
- última falha registrada, quando existir;
- ação **Restaurar**;
- zona separada **Excluir permanentemente**.

No desktop o inspetor fica ao lado da lista. Em largura menor ele passa para uma única coluna.

## Seleção em lote

A toolbar de lote só aparece quando existe seleção.

Ações:

- restaurar selecionadas;
- excluir selecionadas permanentemente.

Resultados parciais mantêm somente falhas selecionadas quando aplicável.

### Regra de filtro

Alterar a busca limpa a seleção e fecha o inspetor.

Motivo: uma operação destrutiva nunca deve continuar apontando para itens que deixaram de estar visíveis por causa do filtro.

## Concorrência

O cliente limita concorrência via `runAdminBatch()`. Operações de mídia continuam serializadas/protegidas pela infraestrutura de quarentena do servidor.

Uma falha em uma faixa não deve cancelar resultados independentes já concluídos.

## Refresh da biblioteca

Exclusões permanentes em lote podem agrupar o refresh/reconciliação necessário ao final para evitar scan desnecessário por item.

Se o arquivo foi excluído mas o refresh falhar, a interface deve apresentar o erro de cleanup em vez de fingir sucesso completo.

## Segurança

- somente `admin` pode usar as APIs;
- mutações exigem `X-Home-Music-Request: 1`;
- quarentena é preferida à exclusão direta;
- exclusão permanente é explícita;
- lote destrutivo exige confirmação digitada;
- filtro não mantém seleção oculta;
- o frontend nunca recebe permissão para escolher path absoluto de delete;
- erros não devem vazar caminhos físicos além do caminho relativo administrativo já previsto para revisão.

## Relação com Gerenciar músicas

`Gerenciar músicas` envia faixas para a lixeira; ele não deve oferecer exclusão física direta da biblioteca ativa.

Essa separação preserva uma etapa de recuperação antes do delete definitivo.
