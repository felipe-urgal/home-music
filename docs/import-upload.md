# Upload local de mídia

A issue #93 habilita a primeira entrada real de arquivos na Fase 9. O upload local reutiliza a fila de importação e o staging seguro criado na #92; nenhum byte recebido pela API é gravado diretamente em `MUSIC_DIR`.

## Fluxo

1. o administrador escolhe um arquivo ou arrasta um arquivo para a área de upload;
2. `POST /api/admin/imports/uploads` valida nome, extensão e tamanho declarado, cria o job da fila e o workspace de staging;
3. o navegador envia o arquivo em streaming por `PUT /api/admin/imports/uploads/:id` com `application/octet-stream`;
4. o backend limita os bytes enquanto lê o stream e grava exclusivamente com `ImportStagingManager.writePayload()`;
5. o cliente usa `XMLHttpRequest.upload.onprogress` para mostrar progresso real da transferência;
6. ao fim do recebimento, o job permanece `pending`: o arquivo está no staging e ainda aguarda as validações e decisões das próximas etapas da Fase 9;
7. `DELETE /api/admin/imports/uploads/:id` cancela o job e remove o workspace de staging. Se houver transferência ativa, o servidor interrompe o stream e aguarda o encerramento antes de responder.

## Formatos e tamanho

Os formatos aceitos são os mesmos que a biblioteca já reconhece atualmente:

- `.mp3`
- `.flac`
- `.wav`
- `.m4a`
- `.aac`
- `.ogg`
- `.opus`

O limite padrão é 512 MB por arquivo e pode ser configurado com:

```env
HOME_MUSIC_IMPORT_UPLOAD_MAX_MB=512
```

São aceitos valores inteiros entre 1 e 8192 MB. O limite é validado tanto no tamanho declarado quanto durante a leitura do stream; portanto um cliente não pode contornar o limite enviando mais bytes do que declarou.

## Segurança

- todas as rotas ficam sob `/api/admin/*` e exigem administrador autenticado;
- POST, PUT e DELETE também exigem `X-Home-Music-Request: 1` pela política central de mutações;
- o nome externo do arquivo serve apenas como label do job e para validar a extensão; ele nunca define o caminho do staging;
- nomes com separadores, controles ou tamanho excessivo são recusados;
- o payload usa o nome interno fixo `payload.bin` dentro do workspace aleatório da #92;
- arquivo vazio, extensão não suportada, tamanho acima do limite, tamanho recebido diferente do declarado e bytes excedentes falham antes de qualquer promoção;
- falha e cancelamento removem o staging do job;
- esta entrega não chama `promote()` e, portanto, não torna o arquivo visível em `MUSIC_DIR`.

## UX

A tela Administração → Importar mídia mostra:

- seletor de arquivo e drag-and-drop;
- formatos aceitos e limite configurado;
- nome e tamanho do arquivo atual;
- percentual de transferência;
- etapa atual (`Preparando staging`, `Enviando arquivo`, `Aguardando validação`, `Cancelando`, `Cancelado` ou `Falhou`);
- cancelamento do upload/job;
- erros de formato/tamanho e falhas do servidor em linguagem acionável;
- a fila central abaixo do upload, mantendo URL e providers como fontes ainda não habilitadas.

## Limite de escopo

`pending` após o upload é intencional. A #93 confirma somente que o arquivo foi recebido integralmente e está isolado no staging. FFmpeg/ffprobe e perfis de saída (#97), metadata/preview (#98), duplicatas (#99), destino/promoção (#100), cleanup de resíduos após restart (#101) e atualização incremental da biblioteca (#103) continuam como etapas próprias do pipeline.

## Testes

A cobertura inclui:

- upload válido permanece no staging e não cria arquivo em `MUSIC_DIR`;
- formato inválido e arquivo grande são recusados antes do staging;
- bytes acima do tamanho declarado falham e limpam staging;
- cancelamento durante transferência encerra o job e limpa staging;
- autorização admin e header de mutação nas rotas;
- Playwright para seleção de arquivo, progresso, cancelamento e drag-and-drop.
