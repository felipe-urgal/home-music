# FFmpeg no Home Music

O Home Music usa FFmpeg como dependência **opcional** para os próximos recursos de transcoding e perfis de qualidade. O streaming atual de arquivos continua sendo direto, com HTTP Range, e não depende de FFmpeg.

## Instalação no Ubuntu

```bash
sudo apt update
sudo apt install ffmpeg
```

Valide a instalação:

```bash
ffmpeg -version
npm run ffmpeg:status
```

O segundo comando usa a mesma lógica de probe do servidor e respeita `HOME_MUSIC_FFMPEG_PATH`.

## Configuração

Sem configuração extra, o Home Music procura o executável `ffmpeg` no `PATH` do processo:

```env
HOME_MUSIC_FFMPEG_PATH=ffmpeg
```

Se o serviço precisar usar um binário específico, informe o caminho do executável, sem argumentos adicionais:

```env
HOME_MUSIC_FFMPEG_PATH=/usr/bin/ffmpeg
```

O comando é executado diretamente com `execFile`, sem shell, e o probe usa somente o argumento fixo `-version`. O processo tem timeout e limite de saída para que um binário quebrado ou incompatível não prenda a inicialização.

## Comportamento quando FFmpeg não existe

FFmpeg **não participa do readiness**. Se o binário estiver ausente, demorar demais, falhar ou produzir uma saída inesperada:

- `/health` continua funcionando;
- `/ready` continua dependendo apenas de frontend, autenticação e biblioteca;
- o streaming original continua funcionando normalmente;
- o servidor registra um aviso e expõe o motivo no `/api/health` autenticado.

O smoke test de produção força deliberadamente um caminho inexistente para garantir essa propriedade no CI.

## Diagnóstico

`GET /api/health` inclui:

```json
{
  "ffmpeg": {
    "available": true,
    "version": "7.1.1",
    "customPath": false,
    "issue": null
  }
}
```

Quando o executável não está disponível, `available` fica `false`, `version` fica `null` e `issue` informa uma categoria estável como `not-found`, `timeout`, `failed`, `invalid-command` ou `invalid-output`.

O health não expõe o caminho completo configurado para não transformar o endpoint em inventário de filesystem.

## Escopo desta fase

Esta etapa **não altera a URL de streaming nem converte áudio**. Ela entrega apenas a fundação operacional e testável para o próximo estágio:

1. selecionar quando transcoding é necessário;
2. criar um processo FFmpeg por stream convertido, com limites de concorrência e shutdown limpo;
3. definir formato/bitrate de saída compatível com iPhone;
4. adicionar perfis de qualidade para Wi-Fi e 4G/5G;
5. manter o streaming direto como caminho preferencial quando não houver benefício em converter.
