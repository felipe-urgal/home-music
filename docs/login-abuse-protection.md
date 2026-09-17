# Proteção contra abuso no login

Este documento descreve as proteções correntes dos fluxos de autenticação contra brute force, abuso de CPU e criação excessiva de pedidos efêmeros.

A proteção é deliberadamente **em camadas**. Nenhuma camada depende de o usuário existir no SQLite para decidir a resposta pública.

## Login por usuário e senha

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

O limite de sessões é independente e continua documentado em [`multi-user-auth.md`](multi-user-auth.md).

### Limite por IP

O IP efetivo continua sendo resolvido por `loginRateLimitKey`.

`X-Forwarded-For` só é aceito quando o backend está atrás do proxy loopback confiável configurado pelo fluxo Tailscale. Fora desse cenário, o endereço do socket permanece a autoridade.

Default:

- 8 falhas por IP;
- janela de 5 minutos;
- até 512 chaves rastreadas diretamente.

#### Saturação do mapa

O mapa não remove mais a entrada mais antiga para admitir uma chave nova.

Quando todas as entradas estão ocupadas:

- entradas já rastreadas permanecem preservadas, inclusive atacantes já bloqueados;
- novas chaves passam por um bucket compartilhado de overflow enquanto a capacidade direta continuar cheia;
- o overflow tem a mesma janela e o mesmo limite de falhas;
- limpar uma chave individual em login bem-sucedido não limpa o overflow compartilhado.

Isso impede churn de IPs de expulsar a proteção efetiva de um atacante ativo. Se uma vaga direta reaparecer por expiração ou limpeza legítima, uma chave nova pode voltar a ser rastreada individualmente; o gate global de `scrypt` continua limitando o custo agregado independentemente desse estado.

### Limite por identidade

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

### Gate global de `scrypt`

Mesmo com IPs e identidades diferentes, a quantidade de trabalho criptográfico é limitada globalmente por processo.

Defaults:

- no máximo 4 verificações de senha simultâneas;
- no máximo 64 verificações iniciadas por janela de 60 segundos;
- ao esgotar o orçamento por janela, backoff global de pelo menos 30 segundos e nunca menor que o restante da janela corrente.

O gate é adquirido imediatamente antes de `AccountPasswordService.authenticate` e liberado em `finally`, inclusive quando a autenticação lança erro.

Não existe fila ilimitada de verificações de senha. Se a concorrência já estiver cheia, a nova tentativa recebe rate limit e pode tentar novamente depois.

### Respostas públicas

Bloqueios por IP, identidade, concorrência ou orçamento global usam a mesma superfície:

```text
HTTP 429
Retry-After: <segundos>
{"error":"Muitas tentativas. Aguarde alguns minutos e tente novamente."}
```

O motivo interno do bloqueio não é enviado ao cliente. Nos limiters por IP/identidade, o `Retry-After` é conservador e corresponde à janela configurada; o gate global usa o tempo restante calculado para a condição de concorrência/backoff.

Credenciais inválidas continuam retornando:

```text
HTTP 401
{"error":"Usuário ou senha inválidos."}
```

A saturação do armazenamento de sessões é outro domínio e continua retornando `503` conforme [`multi-user-auth.md`](multi-user-auth.md).

## Login da TV pelo celular

O fluxo de device login entregue no primeiro estágio da issue #428 não executa `scrypt`, mas cria estado efêmero e portanto possui limites próprios.

`POST /api/auth/device/start` é protegido por `TvDeviceLoginManager` antes de criar um pedido novo.

Defaults:

- TTL do pedido: 5 minutos;
- até 64 pedidos ativos globais;
- até 4 pedidos ativos por origem/IP;
- até 8 tentativas de `start` por origem a cada 60 segundos;
- até 512 entradas diretas no mapa de rate limit, com bucket de overflow quando saturado.

A chave de origem é derivada da origem/IP efetivo do request conforme o wiring de autenticação. O manager não precisa saber se alguma conta existe para aceitar ou limitar o início do fluxo.

### Capacidade e rate limit

Há duas proteções separadas:

1. **rate limit de criação** — limita frequência de chamadas a `start` por origem;
2. **capacidade ativa** — limita quantos pedidos ainda pendentes/aprovados/consumindo podem existir globalmente e por origem.

Ao atingir limite, a API responde de forma controlada com `Retry-After`. O objetivo é evitar consumo de memória ou spam de QR/pedidos sem expulsar estado válido de terceiros.

Pedidos terminais (`denied`, `expired`, `consumed`) são retidos por uma janela curta de 60 segundos e depois limpos.

### Replay e enumeração

Além do rate limit:

- `requestId`, `deviceToken` e `approvalToken` são valores independentes;
- tokens brutos não ficam armazenados no estado interno;
- approve/deny/consume são condicionados ao estado atual;
- consumo é único;
- replay não cria nova sessão;
- polling/status não expõe identidade do usuário aprovado;
- respostas usam `Cache-Control: no-store`;
- tokens malformados/grandes são rejeitados antes de trabalho desnecessário.

O código curto visual não é credencial e não substitui `approvalToken`/`deviceToken`.

### Separação do login por senha

Os budgets não são compartilhados automaticamente:

- brute force de senha continua sob IP + identidade + gate global de `scrypt`;
- criação de pedidos de login da TV usa os limites do `TvDeviceLoginManager`;
- capacidade do `SessionManager` só entra quando o pedido aprovado é consumido para criar a sessão final da TV.

Essa separação evita transformar device login em bypass dos limites de sessão ou misturar custo de `scrypt` com um fluxo que não verifica senha na TV.

## Configuração do login por senha

Os limites do login por usuário/senha têm defaults seguros e podem ser ajustados por ambiente:

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

Os limites do device login são atualmente constantes do manager e têm cobertura unitária com opções injetáveis para teste. Mudança futura para torná-los configuráveis por ambiente deve atualizar esta tabela/documento.

## Métricas e dados sensíveis

`LoginAbuseProtection.metrics()` mantém contadores agregados em memória para o fluxo de senha:

- tentativas avaliadas;
- autenticações com sucesso/falha;
- bloqueios por IP e identidade;
- verificações iniciadas;
- rejeições por concorrência e por janela;
- verificações atualmente em voo e contagem da janela.

Esses contadores não carregam senha, cookie, token, username bruto nem chave de limiter.

O device login mantém apenas estado operacional necessário em memória e hashes dos segredos; não deve expor `deviceToken`, `approvalToken`, cookie de sessão ou identidade aprovada em logs/métricas.

## Persistência e restart

As proteções descritas aqui são **voláteis por processo**.

Reiniciar o servidor zera:

- falhas por IP/identidade do login por senha;
- overflow e budget/backoff global de `scrypt`;
- contadores agregados;
- pedidos de device login, respectivos rate limits e estado terminal retido;
- sessões web em memória.

A decisão é intencional para a arquitetura atual de instância única. Persistência distribuída/compartilhada deve ser tratada em issue própria se o Home Music passar a operar com múltiplos processos/instâncias.

## Regressões obrigatórias

A cobertura deve preservar pelo menos:

### Login por senha

- IP único bloqueado e recuperação após janela;
- múltiplos IPs contra a mesma identidade;
- churn de entradas sem expulsar atacante bloqueado;
- limite global de concorrência de verificações;
- orçamento global por janela e recuperação após backoff;
- resposta pública indistinguível para usuário existente/inexistente com credencial inválida;
- nenhuma emissão de cookie quando o login não conclui com sucesso.

### Device login

- limite de `start` por origem;
- capacidade global e por origem;
- overflow do limiter sem crescimento ilimitado;
- TTL/cleanup;
- approve/deny/consume one-shot;
- replay de consume sem segunda sessão;
- rollback quando `SessionManager` não consegue criar a sessão final;
- tokens malformados/grandes rejeitados;
- nenhuma exposição dos segredos brutos no estado interno.

As regressões sensíveis continuam fazendo parte da suíte geral e dos gates de segurança aplicáveis.
