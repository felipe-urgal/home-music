# Arquitetura

## Fluxo

```text
Celular / PWA
     |
     | HTTP
     v
React + Vite
     |
     | /api
     v
Fastify
     |
     +--> scanner de biblioteca
     +--> music-metadata
     +--> endpoint de capa
     +--> streaming HTTP Range
     |
     v
MUSIC_DIR no Ubuntu
```

## Decisões do MVP

### Biblioteca

A biblioteca é reconstruída em memória ao iniciar o backend e pode ser atualizada por `POST /api/library/scan`. Persistência em SQLite entra na fase seguinte, quando favoritos, playlists e histórico forem implementados.

### Streaming

`GET /api/tracks/:id/stream` aceita o cabeçalho `Range`, permitindo seek sem baixar o arquivo inteiro.

### Segurança

O MVP pressupõe rede local ou Tailscale. Não há autenticação e o backend não deve ser publicado diretamente na internet.

### Transcoding

Arquivos são entregues no formato original. FFmpeg/transcoding adaptativo fica para uma fase posterior, principalmente para FLAC/WAV via 4G/5G.
