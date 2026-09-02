# Proteção contra abuso no login

Este documento descreve a proteção corrente do endpoint `POST /api/auth/login` contra brute force distribuído e abuso de CPU das verificações `scrypt`.

A proteção é deliberadamente **em camadas**. Nenhuma camada depende de o usuário existir no SQLite para decidir a resposta pública.

## Fluxo

```text
requisição de login
    ↓
limite por IP
    ↓
limite por identidade normalizada
    ↓
gate global de verificação de senha
    ↓
scrypt / autenticação
    ↓
sessão
```

O limite de sessões é independente e continua documentado em `multi-user-auth.md`.

## Limite por IP

O IP efetivo continua sendo resolvido por `loginRateLimitKey`.

`X-Forwarded-For` só é aceito quando o backend está atrás do proxy loopback confiável configurado pelo fluxo Tailscale. Fora desse cenário, o endereço do socket permanece a autoridade.

Default:

- 8 falhas por IP;
- janela de 5 minutos;
- até 512 chaves rastreadas diretamente.

### Saturação do mapa

O mapa não remove mais a entrada mais antiga para admitir uma chave nova.

Quando todas as entradas estão ocupadas:

- entradas já rastreadas permanecem preservadas, inclusive atacantes já bloqueados;
- novas chaves passam por um bucket compartilhado de overflow;
- o overflow tem a mesma janela e o mesmo limite de falhas;
- limpar uma chave individual em login bem-sucedido não limpa o overflow compartilhado.

Isso impede churn de IPs de expulsar a proteção efetiva de um atacante ativo.

## Limite por identidade

A identidade usa a mesma normalização de username aplicada pela autenticação:

- trim;
- NFKC;
- lowercase;
- limites de tamanho e caracteres existentes.

O valor usado como chave no limiter é um SHA-256 da identidade normalizada. Identidades inválidas compartilham um bucket canônico, evitando armazenar a entrada bruta no limiter.

Default:

- 12 falhas por identidade;
- mesma janela de 5 minutos do limite por IP.

Vários IPs atacando o mesmo username portanto compartilham o orçamento da identidade.

Essa camada é aplicada antes da consulta/verificação de credencial e não consulta se a conta existe. Usuário existente e inexistente continuam recebendo a mesma resposta pública para credenciais inválidas.

## Gate global de `scrypt`

Mesmo com IPs e identidades diferentes, a quantidade de trabalho criptográfico é limitada globalmente por processo.

Defaults:

- no máximo 4 verificações de senha simultâneas;
- no máximo 64 verificações iniciadas por janela de 60 segundos;
- ao esgotar o orçamento por janela, backoff global de pelo menos 30 segundos e nunca menor que o restante da janela corrente.

O gate é adquirido imediatamente antes de `AccountPasswordService.authenticate` e liberado em `finally`, inclusive quando a autenticação lança erro.

Não existe fila ilimitada de verificações de senha. Se a concorrência já estiver cheia, a nova tentativa recebe rate limit e pode tentar novamente depois.

## Respostas públicas

Bloqueios por IP, identidade, concorrência ou orçamento global usam a mesma superfície:

```text
HTTP 429
Retry-After: <segundos>
{"error":"Muitas tentativas. Aguarde alguns minutos e tente novamente."}
```

O motivo interno do bloqueio não é enviado ao cliente.

Credenciais inválidas continuam retornando:

```text
HTTP 401
{"error":"Usuário ou senha inválidos."}
```

A saturação do armazenamento de sessões é outro domínio e continua retornando `503` conforme `multi-user-auth.md`.

## Configuração

Todos os limites têm defaults seguros e podem ser ajustados por ambiente:

| Variável | Default | Finalidade |
| --- | ---: | --- |
| `HOME_MUSIC_LOGIN_IP_MAX_FAILURES` | `8` | falhas por IP na janela |
| `HOME_MUSIC_LOGIN_IDENTITY_MAX_FAILURES` | `12` | falhas por identidade na janela |
| `HOME_MUSIC_LOGIN_WINDOW_SECONDS` | `300` | janela dos limiters por IP/identidade |
| `HOME_MUSIC_LOGIN_LIMITER_MAX_ENTRIES` | `512` | entradas diretas de cada limiter antes do overflow |
| `HOME_MUSIC_LOGIN_MAX_CONCURRENT_VERIFICATIONS` | `4` | verificações `scrypt` simultâneas |
| `HOME_MUSIC_LOGIN_MAX_VERIFICATIONS_PER_WINDOW` | `64` | orçamento global de verificações por janela |
| `HOME_MUSIC_LOGIN_GLOBAL_WINDOW_SECONDS` | `60` | janela do orçamento global |
| `HOME_MUSIC_LOGIN_BACKOFF_SECONDS` | `30` | backoff mínimo após esgotar o orçamento global |

Configurações inválidas não derrubam o servidor: a infraestrutura registra aviso e volta ao conjunto padrão completo.

## Métricas e dados sensíveis

`LoginAbuseProtection.metrics()` mantém contadores agregados em memória para inspeção/integração de observabilidade:

- tentativas avaliadas;
- autenticações com sucesso/falha;
- bloqueios por IP e identidade;
- verificações iniciadas;
- rejeições por concorrência e por janela;
- verificações atualmente em voo e contagem da janela.

Esses contadores não carregam senha, cookie, token, username bruto nem chave de limiter.

## Persistência e restart

Os limiters, orçamento global e métricas são **voláteis por processo**.

Reiniciar o servidor zera:

- falhas por IP;
- falhas por identidade;
- overflow;
- janela/backoff global;
- contadores agregados.

A decisão é intencional para esta fase: não persistir estado de defesa no SQLite evita escrita síncrona no caminho crítico de login e evita transformar corrupção/staleness de rate limit em indisponibilidade persistente. A defesa continua efetiva durante a vida do processo e o restart já invalida as sessões em memória.

Persistência distribuída ou compartilhada deve ser tratada em issue própria se o Home Music passar a operar com múltiplos processos/instâncias.

## Regressões obrigatórias

A cobertura deve preservar pelo menos:

- IP único bloqueado e recuperação após janela;
- múltiplos IPs contra a mesma identidade;
- churn de entradas sem expulsar atacante bloqueado;
- limite global de concorrência de verificações;
- orçamento global por janela e recuperação após backoff;
- resposta pública indistinguível para usuário existente/inexistente com credencial inválida;
- nenhuma emissão de cookie quando o login não conclui com sucesso.

As regressões centrais desta política fazem parte de `npm run test:security` além da suíte geral.
