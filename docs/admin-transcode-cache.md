# Armazenamento e cache de transcoding

A issue #89 adiciona visibilidade do armazenamento e manutenção segura do cache de transcoding pela Administração.

## Objetivo

A Administração passa a diferenciar explicitamente:

- **biblioteca física**: soma dos arquivos de áudio indexados em `MUSIC_DIR`;
- **cache de transcoding**: arquivos derivados gerados pelo FFmpeg em `data/transcode-cache`;
- **limite configurado**: teto definido por `HOME_MUSIC_TRANSCODE_CACHE_MB`.

A limpeza do cache nunca recebe nem percorre `MUSIC_DIR`. Arquivos de áudio originais ficam fora da superfície de manutenção.

## API administrativa

### `GET /api/admin/transcoding/cache`

Retorna:

- `bytes`: espaço atual ocupado por arquivos reconhecidos do cache;
- `limitBytes`: limite configurado;
- `entries`: quantidade de arquivos finais `.m4a`;
- `temporaryEntries`: temporários de transcoding reconhecidos;
- `active`: operações/transcodes ativos;
- `pending`: transcodes aguardando execução.

A rota está em `/api/admin/*`, portanto exige role `admin` pela política central de autorização.

### `DELETE /api/admin/transcoding/cache`

Remove somente arquivos derivados reconhecidos e retorna:

- `freedBytes`;
- `removedEntries`;
- `failedEntries`;
- estado final do cache em `cache`.

Como toda mutação da API, exige `X-Home-Music-Request: 1`.

## Arquivos que podem ser removidos

A manutenção usa allowlist de nomes gerados pelo próprio `TranscodeManager`:

- final: `<sha256 de 64 caracteres>.m4a`;
- temporário: `<sha256>.m4a.tmp-<uuid>`.

Entradas com outro nome, diretórios e symlinks são ignorados. O próprio diretório configurado de cache também é validado com `lstat` e é rejeitado se for um symlink ou não for um diretório regular. Isso reduz o blast radius mesmo se o estado do filesystem tiver sido alterado fora do Home Music.

## Concorrência

A limpeza é serializada por `TranscodeCacheMaintenance`.

Antes de limpar:

1. a manutenção bloqueia a entrada de novas operações protegidas;
2. verifica operações de transcode já protegidas;
3. verifica `activeCount` e `pendingCount` do `TranscodeManager`;
4. se houver atividade, responde `409` sem remover nenhum arquivo.

No endpoint de playback, a região protegida engloba:

1. abertura da fonte física;
2. `TranscodeManager.prepare()`;
3. abertura do arquivo transcodificado final.

Isso elimina a corrida em que a limpeza poderia remover o arquivo entre o fim do preparo e a abertura para streaming. Depois que o handle está aberto, o alvo de produção Ubuntu/POSIX permite unlink do cache sem invalidar o descritor já aberto.

## Falhas parciais

Cada remoção é tratada individualmente. Se algum arquivo não puder ser apagado:

- a API não declara que todo o cache foi limpo;
- `failedEntries` informa a quantidade de falhas;
- `freedBytes` é calculado a partir do estado real antes/depois;
- a UI mostra feedback de limpeza parcial.

## Interface

Em **Administração → Visão geral → Armazenamento** são exibidos:

- tamanho da biblioteca física;
- cache atual;
- limite configurado;
- quantidade de arquivos no cache;
- atividade de transcoding.

O botão **Limpar cache** exige confirmação explícita e reforça que somente arquivos derivados são removidos. Quando o estado conhecido está ocupado o botão fica desabilitado; o backend continua sendo a autoridade e retorna `409` se surgir atividade depois do último refresh.

## Segurança

Invariantes da entrega:

- a manutenção não conhece nem recebe o caminho de `MUSIC_DIR`;
- somente o diretório configurado de cache é percorrido;
- o diretório de cache em si não pode ser um symlink;
- somente nomes reconhecidos são candidatos a remoção;
- symlinks e entradas não regulares não são removidos;
- usuários comuns não podem consultar nem limpar o cache;
- mutações exigem o header anti-CSRF já usado pelo restante do Home Music;
- limpeza concorrente com transcoding falha fechada com `409`.

## Testes

A cobertura inclui:

- contabilização de bytes/entradas reconhecidos;
- preservação de arquivos desconhecidos;
- remoção de finais e temporários;
- rejeição do diretório de cache quando ele aponta para um symlink, preservando o alvo;
- bloqueio durante transcode protegido;
- autorização `user` versus `admin`;
- exigência do header de mutação;
- `409` com cache preservado quando há transcoding ativo;
- Playwright da apresentação do armazenamento, confirmação, header da mutação e feedback de espaço liberado sem tocar no cache real do runner.
