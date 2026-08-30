# Upload local de mídia

O upload local é uma das origens do pipeline de importação. Ele reutiliza a fila de jobs e o staging seguro; nenhum byte recebido pela API é gravado diretamente em `MUSIC_DIR`.

## Fluxo atual

1. o administrador escolhe um arquivo ou arrasta um arquivo para a área de upload;
2. `POST /api/admin/imports/uploads` valida nome, extensão e tamanho declarado, cria o job e o workspace de staging;
3. o navegador envia o arquivo em streaming por `PUT /api/admin/imports/uploads/:id` com `application/octet-stream`;
4. o backend limita os bytes durante o stream e grava exclusivamente no staging;
5. o cliente acompanha progresso real da transferência;
6. ao fim do recebimento, o job fica disponível para a etapa **Preparar** do workbench;
7. a validação técnica usa FFprobe/FFmpeg conforme o perfil escolhido;
8. depois vêm preview de metadata, duplicatas, destino seguro, promoção e indexação incremental;
9. cancelamento remove o workspace temporário quando a operação ainda não foi promovida.

O upload é apenas a origem. Depois que os bytes estão no staging, o restante do pipeline é o mesmo usado por URL/provider.

## Formatos e tamanho

Os formatos aceitos são os mesmos reconhecidos pela biblioteca:

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
- o nome externo serve como label/validação de extensão, nunca como caminho de staging;
- nomes com separadores, controles ou tamanho excessivo são recusados;
- o payload usa nome interno controlado pelo servidor dentro do workspace aleatório;
- arquivo vazio, extensão não suportada, tamanho acima do limite, tamanho recebido diferente do declarado e bytes excedentes falham antes da promoção;
- falha e cancelamento removem staging quando aplicável;
- somente a etapa de promoção segura pode tornar o arquivo visível em `MUSIC_DIR`.

## UX atual

Em **Administração → Importar mídia**, o upload participa do workbench de quatro etapas:

```text
Origem → Preparar → Revisar → Biblioteca
```

Na origem, o usuário vê:

- seletor de arquivo e drag-and-drop;
- formatos aceitos e limite configurado;
- nome/tamanho;
- progresso de transferência;
- cancelamento e erros acionáveis.

Depois da aquisição, o painel **Agora** mostra a próxima ação necessária em vez de esconder a validação técnica em detalhes avançados.

## Relação com o restante da Fase 9

As etapas que originalmente foram entregues em issues separadas hoje compõem um único pipeline operacional:

- staging (#92);
- upload (#93);
- URL direta/SSRF (#94);
- providers (#95/#96/#104);
- FFmpeg/FFprobe (#97);
- metadata (#98);
- duplicatas (#99);
- destino/promoção (#100);
- cleanup de resíduos (#101);
- retry (#102);
- indexação incremental (#103);
- lotes/playlists por provider (#154).

## Testes

A cobertura inclui:

- upload válido permanece no staging até promoção;
- formato inválido e arquivo grande são recusados;
- bytes acima do tamanho declarado falham e limpam staging;
- cancelamento durante transferência encerra o job e limpa staging;
- autorização admin e header de mutação;
- integração com validação/promoção/indexação;
- Playwright do fluxo de upload com fixtures controladas.
