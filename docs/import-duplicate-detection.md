# Detecção de duplicatas na importação

A etapa de duplicatas roda depois da validação técnica e do preview de metadata, antes de qualquer promoção para a biblioteca.

## Objetivo

Evitar que uma faixa já existente entre silenciosamente no acervo sem executar nenhuma ação destrutiva sobre o arquivo atual.

## Fontes de comparação

A detecção combina duas camadas:

1. **Hash SHA-256** para igualdade exata de bytes;
2. **Heurísticas conservadoras** por título, artista, álbum, duração e nome do arquivo.

O servidor tenta preservar um fingerprint do payload **antes** de eventual remux/transcode. Também reutiliza o SHA-256 do payload final validado pela etapa técnica. Isso permite reconhecer uma origem idêntica mesmo quando o perfil de saída alterou os bytes finais.

Para arquivos da biblioteca, hashes são calculados sob demanda apenas quando o tamanho é compatível com um fingerprint da importação. O cache usa identidade da faixa, caminho, tamanho e `mtime` e nunca é persistido no job ou enviado para a interface.

## Classificação

Cada correspondência recebe uma confiança:

- `exact`: SHA-256 idêntico;
- `probable`: título + artista + duração/álbum, ou nome de arquivo + artista + duração;
- `possible`: semelhanças parciais que não são fortes o bastante para bloquear;
- `none`: nenhuma correspondência relevante.

Os textos são comparados de forma normalizada, ignorando diferenças de caixa, acentos e separadores. A duração usa tolerância de até `max(2 segundos, 2%)`.

## Decisão do pipeline

A maior confiança encontrada define a disposição:

- `blocked`: duplicata exata; bloqueada por padrão e sem botão de ignorar nesta etapa;
- `review`: duplicata provável; exige revisão manual explícita;
- `notice`: possível duplicata; aparece como aviso, mas não bloqueia;
- `clear`: nenhuma duplicata relevante.

Uma revisão manual só pode ser registrada para `review`. Ela não altera nem exclui a faixa existente e não transforma uma duplicata exata em permitida.

## Invalidação

Se o administrador alterar ou regenerar o preview de metadata, o check de duplicatas é descartado e precisa ser executado novamente. O fingerprint original pré-transformação é preservado enquanto o job continuar ativo.

Cancelamento do job remove tanto o check quanto o fingerprint temporário.

## Biblioteca e privacidade

A consulta padrão lê somente os campos necessários da tabela `tracks` em SQLite e abre arquivos da biblioteca com a mesma proteção de caminho usada pelo servidor. Caminhos absolutos e hashes não são devolvidos ao navegador.

Falhas ao ler um hash individual não geram falso `clear`: o resultado sinaliza que nem todos os hashes comparáveis puderam ser confirmados e mantém as heurísticas visíveis.

## API administrativa

```text
GET  /api/admin/imports/:id/duplicates
POST /api/admin/imports/:id/duplicates
POST /api/admin/imports/:id/duplicates/review
```

As mutações continuam sob a política administrativa e exigem `X-Home-Music-Request`.

## Gate

A etapa atende ao gate quando:

- hash exato bloqueia por padrão;
- casos prováveis exigem revisão manual;
- falsos positivos conservadores não bloqueiam;
- nenhum arquivo existente é excluído ou modificado automaticamente;
- metadata editada invalida check antigo;
- CI completo permanece verde.
