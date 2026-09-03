# Playlists e lotes por provider externo

O Home Music pode tratar uma URL de playlist do YouTube/YouTube Music como um lote administrativo. A playlist é apenas o agrupador: cada mídia continua usando um job e um staging próprios e passa pelo pipeline normal de importação.

## Fluxo

1. o link é analisado sem baixar as mídias;
2. o servidor mostra quantidade e duração conhecida antes de iniciar;
3. o administrador escolhe uma pasta existente ou informa uma nova pasta relativa;
4. os itens são adquiridos sequencialmente;
5. cada item passa por validação técnica, metadata, duplicatas, destino seguro e indexação incremental;
6. falha, duplicata ou item indisponível não apaga nem invalida os demais;
7. o lote termina com resumo de concluídos, duplicados, ignorados, falhos e cancelados.

A inspeção da playlist executa o `yt-dlp` com tolerância a erros por entrada. Assim, uma música privada, removida, bloqueada ou que falhe durante a extração não deve impedir que as demais entradas válidas sejam descobertas.

Durante a importação, cada música também é uma unidade independente. Se a aquisição ou o pipeline de uma faixa falhar, somente aquele item é marcado como `failed`, seu staging é descartado quando aplicável e o lote segue para a próxima música. O lote pode terminar como `completed` com falhas parciais registradas no resumo; somente uma falha do próprio orquestrador do lote encerra os itens restantes.

URLs retornadas pelo extractor não são reutilizadas como origem confiável dos itens. Para YouTube, os jobs filhos são reconstruídos apenas a partir de identificadores de vídeo validados e apontam novamente para um host conhecido do YouTube.

## Qualidade de áudio

O perfil padrão continua sendo `Original`.

O provider escolhe a melhor fonte de áudio real disponível antes do download:

- prefere uma faixa somente de áudio a uma faixa muxada com vídeo;
- prefere lossless quando a origem disponibiliza lossless;
- entre fontes equivalentes, prefere maior bitrate, canais e sample rate;
- se existir uma fonte audio-only de 320 kbps e não existir lossless melhor, ela será escolhida;
- uma origem de 128/160/256 kbps não é artificialmente convertida para MP3 320 kbps, porque isso aumenta o arquivo sem recuperar informação perdida.

A interface mostra a qualidade técnica efetivamente validada (codec e bitrate) e identifica o fluxo externo como “melhor qualidade disponível”.

## Limites

Os defaults são conservadores e podem ser ajustados no ambiente:

```dotenv
# Quantidade máxima de itens inspecionados/importados em um lote.
HOME_MUSIC_IMPORT_BATCH_MAX_ITEMS=50

# Soma máxima dos arquivos adquiridos para o lote.
HOME_MUSIC_IMPORT_BATCH_MAX_MB=2048

# Duração máxima total em minutos.
HOME_MUSIC_IMPORT_BATCH_MAX_DURATION_MINUTES=720
```

A duração conhecida é verificada no preview. Como alguns extractors não informam a duração no modo de inspeção, tamanho e duração também são verificados novamente com os valores reais antes de cada promoção.

## Destino

A pasta da playlist nunca é usada como caminho confiável. O destino passa pela mesma normalização da importação individual:

- caminho relativo a `MUSIC_DIR`;
- sem `..`, caminhos absolutos, symlinks ou nomes portavelmente problemáticos;
- nenhum overwrite silencioso;
- colisões recebem nome alternativo seguro;
- uma nova pasta só é criada durante a promoção efetiva.

## Cancelamento e falha parcial

Cancelar o lote impede novos itens de começarem e tenta cancelar a aquisição corrente quando ela ainda pertence ao provider. Staging descartado é limpo pelo mesmo fluxo seguro já usado nas importações individuais.

Um item que exige revisão manual de metadata ou de possível duplicata é marcado como ignorado no lote; ele não é promovido automaticamente. Duplicata exata é classificada como duplicada e também não é promovida. Erros de uma música individual não interrompem as seguintes: a falha permanece visível no item e no resumo final para diagnóstico posterior.
