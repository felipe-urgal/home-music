# FFmpeg e FFprobe no Home Music

O Home Music usa FFmpeg/FFprobe como dependências **opcionais do produto**, mas importantes para dois domínios diferentes:

1. transcoding/compatibilidade do player;
2. validação e processamento técnico das importações.

O streaming original continua sendo o caminho preferencial quando o navegador pode reproduzir o arquivo diretamente.

## Instalação no Ubuntu

```bash
sudo apt update
sudo apt install ffmpeg
```

O pacote normalmente instala `ffmpeg` e `ffprobe`.

Valide:

```bash
ffmpeg -version
ffprobe -version
npm run ffmpeg:status
```

## Configuração

Sem configuração extra, o Home Music procura os executáveis no `PATH`:

```env
HOME_MUSIC_FFMPEG_PATH=ffmpeg
# HOME_MUSIC_FFPROBE_PATH=ffprobe
```

Também é possível fixar caminhos absolutos:

```env
HOME_MUSIC_FFMPEG_PATH=/usr/bin/ffmpeg
HOME_MUSIC_FFPROBE_PATH=/usr/bin/ffprobe
```

`HOME_MUSIC_FFPROBE_PATH` é opcional. Quando omitido e `HOME_MUSIC_FFMPEG_PATH` aponta diretamente para um executável `ffmpeg`/`ffmpeg.exe`, o servidor pode derivar o executável irmão `ffprobe` no mesmo diretório. Configurações que não representam diretamente o binário esperado não são transformadas permissivamente em comandos arbitrários.

O probe usa APIs sem shell. Processamento real também usa argumentos definidos pelo servidor, não strings de comando vindas do cliente.

## Importações: validação técnica

A etapa **Preparar** do workbench de importação valida mídia com FFprobe antes de qualquer promoção para `MUSIC_DIR`.

Perfis atuais:

- **Original**: preserva o arquivo quando ele já contém uma única faixa de áudio segura; quando necessário, prefere remux/stream-copy sem reencode;
- **Economizar espaço**: preserva uma origem já econômica quando possível; caso precise reduzir o áudio, usa M4A/AAC no perfil econômico;
- **Compatibilidade máxima**: prioriza saída M4A/AAC compatível, preservando/remuxando AAC compatível quando possível e transcodificando somente quando necessário.

A decisão técnica registrada no job diferencia:

```text
preserve
remux
transcode
```

Isso permite saber quando os bytes codificados do áudio foram preservados e quando houve reencode.

### Fluxo técnico

1. payload permanece no staging privado;
2. o servidor abre o arquivo de forma segura;
3. FFprobe valida container, codec, duração e streams;
4. o servidor escolhe a faixa de áudio adequada quando há mais de uma;
5. decide `preserve`, `remux` ou `transcode`;
6. FFmpeg produz saída temporária somente quando necessário;
7. saída processada é novamente validada;
8. duração/formato esperado são conferidos;
9. o staging emite o token final usado pelo gate de promoção.

Uma validação bem-sucedida **não significa que a música já foi promovida**. O pipeline ainda passa por revisão de metadata, duplicatas e destino antes de escrever em `MUSIC_DIR`.

## Segurança da importação

- paths arbitrários do usuário não são concatenados em comandos;
- FFmpeg/FFprobe recebem arquivo já aberto/validado pelo servidor;
- protocolos/demuxers são restringidos conforme a política do pipeline;
- saída temporária permanece no workspace controlado;
- stderr bruto não é devolvido ao navegador;
- timeout/falha deixa o job fora da biblioteca;
- FFprobe ausente impede a validação técnica em vez de promover mídia sem inspeção.

## Player: qualidade e compatibilidade

As preferências de reprodução atuais incluem:

- **Por conexão**;
- **Automática**;
- **Original**;
- **Economia**.

A seleção por conexão usa a preferência/detecção de rede para escolher entre o comportamento automático e economia. O modo automático tenta o arquivo original e pode recorrer ao perfil de compatibilidade quando o navegador sinaliza erro de decodificação/formato.

O modo Economia usa transcoding AAC de menor bitrate. O perfil interno `balanced` é usado para fallback de compatibilidade. O perfil interno `high` também é usado quando uma versão processada é necessária para normalização ReplayGain sem forçar o perfil econômico.

Esses perfis internos não precisam aparecer como escolhas manuais separadas na UI.

## ReplayGain

Quando a normalização está efetivamente ativa, o servidor resolve o ganho a partir do índice da própria faixa; o cliente não envia um valor arbitrário de dB.

O cache diferencia combinação de:

- faixa/arquivo;
- `mtime`;
- perfil de qualidade;
- modo/ganho efetivo de normalização.

Assim versões normalizadas e não normalizadas não colidem.

Se a preparação normalizada falhar, o player pode recorrer ao caminho não normalizado compatível com a política atual. O arquivo original nunca é alterado.

Downloads offline continuam usando o arquivo original e não aplicam ReplayGain ao artefato baixado.

## Cache de transcoding do player

O cache padrão fica em:

```text
data/transcode-cache/
```

Pode ser limitado por:

```env
HOME_MUSIC_TRANSCODE_CACHE_MB=512
```

O padrão é 512 MB, respeitando a faixa aceita pelo servidor.

O Home Music prepara arquivos derivados antes de servi-los para manter suporte previsível a HTTP Range/seek. Requisições concorrentes da mesma combinação compartilham o trabalho quando aplicável.

A Administração oferece visibilidade e limpeza segura desse cache sem percorrer `MUSIC_DIR`. Detalhes: [admin-transcode-cache.md](admin-transcode-cache.md).

## Rota de transcoding do player

```text
GET /api/tracks/:id/transcode?quality=economy|balanced|high
```

A rota exige sessão autenticada e segue as políticas privadas do produto.

Headers diagnósticos podem informar o perfil e se o resultado veio do cache.

## Comportamento quando FFmpeg/FFprobe não existem

FFmpeg **não participa do readiness principal** do Home Music.

Se FFmpeg estiver indisponível:

- `/health` e `/ready` continuam seguindo os critérios normais da aplicação;
- streaming original continua disponível quando o navegador suporta o arquivo;
- transcoding/fallback que dependem de FFmpeg ficam indisponíveis;
- o health autenticado expõe diagnóstico sanitizado.

Se FFprobe estiver indisponível:

- a biblioteca existente continua operando;
- a auditoria/validação que depende dele reporta a limitação;
- uma importação não deve pular a inspeção técnica e promover o arquivo como se estivesse validado.

## Diagnóstico

`GET /api/health` inclui diagnóstico de FFmpeg/transcoding sem expor caminhos completos do filesystem.

Exemplo conceitual:

```json
{
  "ffmpeg": {
    "available": true,
    "version": "...",
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

Falhas de detecção são reduzidas a categorias estáveis em vez de expor stderr ou paths sensíveis.

## Relação com o pipeline atual

FFmpeg/FFprobe são apenas a etapa técnica. O pipeline completo já entregue é:

```text
Origem
  ↓
staging/scratch
  ↓
FFprobe/FFmpeg
  ↓
metadata
  ↓
duplicatas
  ↓
destino seguro
  ↓
promoção
  ↓
indexação incremental
```

Detalhes relacionados:

- [import-staging.md](import-staging.md)
- [import-metadata-preview.md](import-metadata-preview.md)
- [import-duplicate-detection.md](import-duplicate-detection.md)
- [import-safe-destination.md](import-safe-destination.md)
