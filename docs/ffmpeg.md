# FFmpeg e transcoding no Home Music

O Home Music usa FFmpeg como dependência **opcional** para transcoding do player e como ferramenta de conversão quando uma importação precisa mudar de formato. O streaming original continua sendo o caminho padrão e permanece servido diretamente com HTTP Range.

A validação técnica de uma importação usa **FFprobe** antes de qualquer promoção para a biblioteca. Se a mídia já atende ao perfil escolhido, o arquivo é preservado sem transcode.

## Instalação no Ubuntu

```bash
sudo apt update
sudo apt install ffmpeg
```

O pacote instala `ffmpeg` e `ffprobe`. Valide a instalação:

```bash
ffmpeg -version
ffprobe -version
npm run ffmpeg:status
```

O último comando usa a mesma lógica de probe do servidor para FFmpeg e respeita `HOME_MUSIC_FFMPEG_PATH`.

## Configuração

Sem configuração extra, o Home Music procura `ffmpeg` e `ffprobe` no `PATH` do processo:

```env
HOME_MUSIC_FFMPEG_PATH=ffmpeg
# HOME_MUSIC_FFPROBE_PATH=ffprobe
```

Se o serviço precisar usar binários específicos, informe somente os caminhos dos executáveis, sem argumentos adicionais:

```env
HOME_MUSIC_FFMPEG_PATH=/usr/bin/ffmpeg
HOME_MUSIC_FFPROBE_PATH=/usr/bin/ffprobe
```

`HOME_MUSIC_FFPROBE_PATH` é opcional. Quando ele não está definido e `HOME_MUSIC_FFMPEG_PATH` contém um caminho completo, o servidor procura `ffprobe` no mesmo diretório do FFmpeg. Caso contrário, usa `ffprobe` do `PATH`.

O probe de disponibilidade do FFmpeg usa `execFile`, sem shell, somente com o argumento fixo `-version`. O transcoding do player e a conversão de importações usam `spawn`, também sem shell e com argumentos definidos pelo servidor.

O cache de transcoding do player pode ser limitado com:

```env
HOME_MUSIC_TRANSCODE_CACHE_MB=512
```

O padrão é 512 MB e os valores aceitos vão de 64 a 8192 MB. Os arquivos ficam em `data/transcode-cache/`, com diretório `0700` e arquivos `0600`. O cache não é versionado pelo Git.

## Validação técnica das importações

A tela **Administração → Importar mídia** oferece três perfis de saída:

- **Original**: padrão. Preserva o arquivo quando há uma única faixa de áudio, nenhum vídeo e o container/codec são reconhecidos. Não há transcode desnecessário;
- **Economizar espaço**: preserva uma origem já econômica; caso contrário converte somente a melhor faixa de áudio para M4A/AAC a 96 kbps;
- **Compatibilidade máxima**: preserva uma origem que já seja M4A/MP4 com AAC compatível; caso contrário converte para M4A/AAC a 160 kbps.

O fluxo técnico é deliberadamente separado da promoção para `MUSIC_DIR`:

1. a mídia permanece no staging privado;
2. o servidor abre o payload já validado pelo staging e entrega ao FFprobe somente um descritor de arquivo herdado;
3. FFprobe valida container, codec, duração e streams com protocolos e demuxers limitados;
4. o servidor escolhe deterministicamente a melhor faixa de áudio quando há mais de uma;
5. a decisão `preserve` ou `transcode` é registrada no job;
6. se houver conversão, FFmpeg grava uma saída temporária dentro do mesmo workspace, sem metadados, capítulos, vídeo, legendas ou streams de dados;
7. a saída substitui o payload do staging e é examinada novamente pelo FFprobe;
8. o servidor compara a duração antes/depois e só então produz o token final de validação do staging.

Uma execução bem-sucedida **não promove a música para a biblioteca**. A promoção definitiva pertence às etapas seguintes do pipeline de importação.

### Limites de segurança

A validação não passa uma URL ou caminho controlado pelo usuário para FFmpeg/FFprobe. A entrada é `/proc/self/fd/3`, associada ao descritor do arquivo regular já aberto pelo servidor dentro do staging. A execução restringe protocolos a `file,pipe` e usa uma allowlist de demuxers de áudio/mídia conhecida.

Erros brutos de FFmpeg/FFprobe não são persistidos na fila. A API converte falhas em mensagens estáveis como mídia inválida, ferramenta indisponível ou timeout. Se FFprobe não estiver disponível, a validação responde `503` e o arquivo não é promovido.

## Modos no player

O menu do player oferece três escolhas:

- **Automática**: usa o arquivo original. Se o navegador indicar erro de decodificação/formato, tenta AAC 160 kbps como fallback de compatibilidade;
- **Original**: sempre usa `/api/tracks/:id/stream`, sem FFmpeg;
- **Economia**: usa AAC 96 kbps para reduzir banda.

A preferência fica somente no dispositivo e não altera o arquivo de origem nem o download offline. Downloads offline continuam usando o arquivo original autenticado.

O backend também possui o perfil `high` de 256 kbps como fundação para os futuros perfis automáticos de Wi-Fi/4G. Ele ainda não aparece como escolha manual nesta etapa.

## Como o transcoding do player preserva seek

O Home Music não envia a saída do FFmpeg diretamente para o `<audio>`. Na primeira solicitação de uma combinação faixa/perfil, o servidor:

1. abre a faixa com as mesmas validações de segurança do streaming original;
2. converte o áudio para M4A/AAC em um arquivo temporário;
3. valida o resultado e faz rename atômico para o cache;
4. serve o arquivo pronto com `Accept-Ranges: bytes` e suporte a 200/206/416.

Isso permite que seek, retomada e Media Session continuem usando comportamento HTTP previsível. Requisições simultâneas da mesma faixa/perfil compartilham o mesmo trabalho de conversão.

O servidor executa no máximo **um transcode por vez** para o cache do player, evitando saturar a máquina. O cache remove arquivos menos recentes quando ultrapassa o limite configurado. A faixa que acabou de ser preparada é preservada para atender a requisição atual, então um único arquivo excepcionalmente grande pode ultrapassar temporariamente o limite até a próxima limpeza.

## Rota autenticada do player

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
- os perfis do player que precisam de transcoding ficam indisponíveis no backend;
- uma importação que precise de conversão falha de forma segura e permanece fora da biblioteca.

A ausência de FFprobe afeta somente a etapa de validação técnica das importações. Ela não altera o readiness nem o streaming já existente.

O smoke test de produção força deliberadamente um caminho de FFmpeg inexistente para garantir que o streaming original e o readiness permaneçam independentes.

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

Quando o executável FFmpeg não está disponível, `available` fica `false`, `version` fica `null` e `issue` informa uma categoria estável como `not-found`, `timeout`, `failed`, `invalid-command` ou `invalid-output`.

O health não expõe o caminho completo configurado para não transformar o endpoint em inventário de filesystem.

## Próximo estágio

A importação agora possui validação técnica e decisão de formato antes da promoção. O estágio seguinte do roadmap extrai metadata confiável e apresenta um preview para revisão administrativa, sem promover automaticamente o arquivo validado.
