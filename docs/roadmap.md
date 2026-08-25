# Roadmap

## Fase 1 — Caminho crítico

- [x] Scanner de músicas
- [x] API de biblioteca
- [x] Streaming com HTTP Range
- [x] Player mobile
- [x] Fila contextual
- [x] Busca básica
- [x] PWA básica

## Fase 2 — Biblioteca pessoal

- [x] SQLite
- [x] Favoritos persistentes
- [x] Histórico / recentes
- [x] Playlists
- [x] Navegação hierárquica por pastas e subpastas
- [x] Re-scan incremental manual
- [x] Re-scan automático periódico opcional
- [x] Ordenação e filtros avançados

## Fase 3 — Experiência mobile

- [x] Shuffle
- [x] Repeat `off / all / one`
- [x] Fila reordenável
- [x] Volume e estado do player persistentes
- [x] Play automático entre faixas
- [x] Retomada automática da sessão quando permitida pelo navegador
- [x] Media Session API
- [x] Controles compatíveis na tela bloqueada/notificações
- [x] Login próprio responsivo sem popup de Basic Auth
- [x] Sessão por cookie HttpOnly
- [x] Layout sem overflow horizontal em telas estreitas
- [x] Capas confinadas sem quebrar a viewport
- [x] Download offline
- [x] Cache seletivo
- [x] Melhor tratamento de capas ausentes

## Fase 4 — Operação no Ubuntu

- [x] Build React servido pelo Fastify
- [x] Frontend + API em uma única porta/processo
- [x] `npm start` de produção
- [x] Cache seguro com `immutable` somente para assets hashados
- [x] Liveness público mínimo + readiness separado
- [x] Diagnóstico detalhado autenticado em `/api/health`
- [x] Shutdown limpo Fastify + SQLite, inclusive durante scan
- [x] Serviço systemd com restart automático e journal
- [x] Update seguro sem versão híbrida de frontend
- [x] Permissões endurecidas para `.env`, `data/` e SQLite
- [x] Escaping de caminhos no unit systemd
- [x] Cookie `Secure` configurável explicitamente para proxy HTTPS confiável
- [x] Smoke test real de `npm start` no CI
- [x] Hardening do processo systemd

## Fase 5 — Fora de casa

- [x] Tailscale Serve privado ao tailnet
- [x] HTTPS automático `*.ts.net`
- [x] Backend restrito a loopback no perfil remoto
- [x] Cookie `Secure` no perfil HTTPS
- [x] Setup/rollback idempotente com proteção contra conflito em 443
- [ ] Aplicar grants/restrições least-privilege no tailnet real
- [ ] FFmpeg
- [ ] Transcoding adaptativo
- [ ] Perfis de qualidade Wi‑Fi / 4G

## Fase 6 — Extras

- [ ] Letras
- [ ] ReplayGain / normalização opcional
- [ ] Estatísticas pessoais
- [ ] Integração opcional com biblioteca DJ
