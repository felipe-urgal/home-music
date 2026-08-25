# FFmpeg e transcoding no Home Music

O Home Music usa FFmpeg como dependência **opcional**. O streaming original continua sendo o caminho padrão e permanece servido diretamente com HTTP Range. O FFmpeg entra somente quando o cliente pede uma qualidade reduzida ou quando o modo automático precisa de uma saída AAC mais compatível.

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

O probe usa `execFile`, sem shell, somente com o argumento fixo `-version`. O transcoding usa `spawn`, também sem shell, com argumentos definidos pelo servidor e entrada vinda de um arquivo já validado dentro de `MUSIC_DIR`.

O cache em disco pode ser limitado com:

```env
HOME_MUSIC_TRANSCODE_CACHE_MB=512
```

O padrão é 512 MB e os valores aceitos vão de 64 a 8192 MB. Os arquivos ficam em `data/transcode-cache/`, com diretório `0700` e arquivos `0600`. O cache não é versionado pelo Git.

## Modos no player

O menu do player oferece três escolhas:

- **Automática**: usa o arquivo original. Se o navegador indicar erro de decodificação/formato, tenta AAC 160 kbps como fallback de compatibilidade;
- **Original**: sempre usa `/api/tracks/:id/stream`, sem FFmpeg;
- **Economia**: usa AAC 96 kbps para reduzir banda.

A preferência fica somente no dispositivo e não altera o arquivo de origem nem o download offline. Downloads offline continuam usando o arquivo original autenticado.

O backend também possui o perfil `high` de 256 kbps como fundação para os futuros perfis automáticos de Wi-Fi/4G. Ele ainda não aparece como escolha manual nesta etapa.

## Como o transcoding preserva seek

O Home Music não envia a saída do FFmpeg diretamente para o `<audio>`. Na primeira solicitação de uma combinação faixa/perfil, o servidor:

1. abre a faixa com as mesmas validações de segurança do streaming original;
2. converte o áudio para M4A/AAC em um arquivo temporário;
3. valida o resultado e faz rename atômico para o cache;
4. serve o arquivo pronto com `Accept-Ranges: bytes` e suporte a 200/206/416.

Isso permite que seek, retomada e Media Session continuem usando comportamento HTTP previsível. Requisições simultâneas da mesma faixa/perfil compartilham o mesmo trabalho de conversão.

O servidor executa no máximo **um transcode por vez** para evitar saturar a máquina. O cache remove arquivos menos recentes quando ultrapassa o limite configurado. A faixa que acabou de ser preparada é preservada para atender a requisição atual, então um único arquivo excepcionalmente grande pode ultrapassar temporariamente o limite até a próxima limpeza.

## Rota autenticada

```text
GET /api/tracks/:id/transcode?quality=economy|balanced|high
```

A rota exige a mesma sessão das demais APIs. A resposta é `audio/mp4`, com `Cache-Control: private, no-store`. O Cache Storage da PWA continua sem interceptar `/api/*`.

Headers diagnósticos da resposta:

```text
X-Home-Music-Transcode-Quality: economy
X-Home-Music-Transcode-Cache: hit|miss
```

Se FFmpeg não estiver disponível, a rota responde `503`; o streaming original não é afetado.

## Comportamento quando FFmpeg não existe

FFmpeg **não participa do readiness**. Se o binário estiver ausente, demorar demais no probe, falhar ou produzir uma saída inesperada:

- `/health` continua funcionando;
- `/ready` continua dependendo apenas de frontend, autenticação e biblioteca;
- o streaming original continua funcionando normalmente;
- o servidor registra um aviso e expõe o motivo no `/api/health` autenticado;
- os perfis que precisam de transcoding ficam indisponíveis no backend.

O smoke test de produção força deliberadamente um caminho inexistente para garantir essa propriedade no CI.

## Diagnóstico

`GET /api/health` inclui os blocos `ffmpeg` e `transcoding`:

```json
{
  "ffmpeg": {
    "available": true,
    "version": "8.0.1-3ubuntu2+esm1",
    "customPath": false,
    "issue": null
  },
  "transcoding": {
    "available": true,
    "profiles": ["economy", "balanced", "high"],
    "cacheLimitMegabytes": 512,
    "active": 0,
    "pending": 0
  }
}
```

Quando o executável não está disponível, `available` fica `false`, `version` fica `null` e `issue` informa uma categoria estável como `not-found`, `timeout`, `failed`, `invalid-command` ou `invalid-output`.

O health não expõe o caminho completo configurado para não transformar o endpoint em inventário de filesystem.

## Próximo estágio

A fundação de transcoding já permite streaming original, fallback de compatibilidade e economia manual. O próximo passo do roadmap é automatizar a escolha de qualidade em **perfis Wi-Fi / 4G**, sem substituir a decisão explícita do usuário quando ele selecionar Original ou Economia.
