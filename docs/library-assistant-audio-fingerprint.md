# Assistente da Biblioteca — identificação por áudio

## Escopo

A identificação por áudio é um fallback opcional para sugestões de metadata que continuam difíceis depois do matching textual/contextual do Assistente. Ela não cria uma nova autoridade, uma nova tabela de faixas nem um segundo motor de matching.

Fluxo:

```text
sugestão de metadata ainda em revisão
  → trackId resolvido no servidor
  → realpath + confinement + arquivo regular
  → Chromaprint/fpcalc local
  → cache por assinatura física
  → AcoustID opcional
  → recording/release-group MusicBrainz
  → rankMusicBrainzCandidate existente
  → novas sugestões metadata no LibraryAssistantStore
  → revisão/aplicação existentes
```

Nenhuma sugestão é aplicada automaticamente por causa do fingerprint. Conflito ou ambiguidade reduz a confiança e mantém decisão humana explícita.

## UX

Em **Administração → Assistente da Biblioteca**, uma sugestão aberta de metadata que ainda exige revisão pode oferecer **Tentar identificar pelo áudio**.

A ação só fica disponível quando o servidor detecta `fpcalc`. A seção **Configurações → Identificação por áudio** mostra apenas:

- disponibilidade e versão do `fpcalc`;
- se AcoustID está habilitado;
- se a application key necessária está configurada.

Paths do host, fingerprint bruto e chave do AcoustID não são publicados para o navegador.

Se AcoustID estiver desativado, a ação pode gerar/reutilizar o fingerprint local sem egress. Isso permite preparar/cachear a evidência sem tornar o provider externo uma dependência do Assistente.

## Chromaprint/fpcalc

`fpcalc` é uma dependência opcional do host. O Home Music não instala nem baixa o binário automaticamente.

Configuração:

```dotenv
# opcional; se ausente, usa fpcalc do PATH
HOME_MUSIC_FPCALC_PATH=/usr/bin/fpcalc
```

A execução usa `execFile` com programa + argumentos, sem shell. O wrapper impõe:

- timeout;
- limite de stdout/stderr;
- `AbortSignal` para cancelamento;
- `windowsHide`;
- parse e limites defensivos do JSON retornado;
- erros sanitizados sem repetir command line, path, stdout ou stderr.

O argumento de mídia vem exclusivamente do índice server-side. O cliente envia apenas `runId` e `suggestionId`.

## Resolução segura da mídia

Antes de executar `fpcalc`, o backend resolve `MUSIC_DIR` e o arquivo indexado com `realpath`. Em seguida:

1. confirma que o caminho real permanece dentro da raiz real da biblioteca;
2. rejeita symlink que escape da raiz;
3. exige arquivo regular;
4. calcula uma assinatura física derivada de caminho relativo, tamanho, `mtimeNs` e inode;
5. revalida arquivo e assinatura depois do fingerprint e depois da consulta externa.

Arquivo removido ou alterado durante a operação invalida a tentativa. O áudio nunca é modificado e nenhum arquivo permanente é criado dentro de `MUSIC_DIR`.

## Cache local de fingerprint

`LibraryAssistantFingerprintCache` persiste somente evidência derivada no mesmo SQLite da aplicação. A chave efetiva inclui `trackId` e uma assinatura física do arquivo, não apenas a identidade lógica da faixa.

Consequências:

- arquivo inalterado reutiliza fingerprint;
- mudança física produz assinatura diferente e força novo cálculo;
- remoção da faixa em `tracks` remove o cache por foreign key/cascade;
- retenção é limitada e entradas antigas podem ser coletadas;
- o cache nunca se torna autoridade da biblioteca.

## AcoustID opcional

AcoustID exige opt-in explícito:

```dotenv
HOME_MUSIC_ACOUSTID_ENABLED=false
# HOME_MUSIC_ACOUSTID_API_KEY=sua-application-key
```

Quando habilitado, a chave permanece somente no servidor. A consulta passa pelo `LibraryAssistantProviderGateway`, reaproveitando timeout, cancelamento, rate limit, cache e validação de provider.

Dados da faixa enviados ao lookup são somente fingerprint e duração, além dos parâmetros de protocolo necessários. O cache lógico do provider usa SHA-256 do fingerprint; o valor bruto não aparece na chave persistida. A URL não contém a application key nem o fingerprint.

A resposta é validada e limitada antes de virar evidência. Testes usam `fetch` fake; CI não consulta o serviço público.

## Integração com o matcher existente

O resultado AcoustID fornece candidatos de gravação/IDs. Esses candidatos voltam ao `rankMusicBrainzCandidate` existente; fingerprint não implementa score textual paralelo.

Os reason codes específicos são:

- `fingerprint.match-strong` — score AcoustID forte;
- `fingerprint.multiple-recordings` — mais de uma gravação próxima continua ambígua;
- `fingerprint.duration-conflict` — duração acústica/candidato conflita com a faixa atual;
- `fingerprint.external-conflict` — gravação apontada pelo fingerprint conflita com evidência externa já presente.

Eles coexistem com os reason codes genéricos (`ambiguous-candidates`, `metadata-conflict`, `source-conflict`, `strong-external-id` etc.) para manter compatibilidade com a política de revisão.

Um match acústico forte não autoriza corrigir metadata contraditória. Quando há conflito ou múltiplas gravações próximas, as sugestões são criadas com baixa confiança e permanecem em revisão.

A integração só sugere campos que o resultado realmente sustenta. Em particular, `albumArtist` não é inferido a partir do artista da gravação, porque isso seria incorreto para compilações e outros lançamentos cujo artista de álbum difere do recording artist.

## Backpressure e cancelamento

Fingerprint roda pela infraestrutura `HeavyWorkQueue` já usada pelo Assistente. A operação revalida a sugestão e a revision da biblioteca depois de aguardar a fila.

Se a sugestão foi resolvida, a biblioteca mudou, o arquivo mudou ou a request foi cancelada, o trabalho não cria novas sugestões. O `AbortSignal` é propagado até `execFile` e ao provider gateway.

## API administrativa

As rotas ficam sob a política administrativa existente:

- `GET /api/admin/library-assistant/fingerprint` — capability sanitizada (`fpcalc` disponível/versão/issue e estado configured do AcoustID);
- `POST /api/admin/library-assistant/runs/:runId/suggestions/:suggestionId/fingerprint` — tenta enriquecer uma sugestão aberta/difícil usando apenas IDs server-side.

A mutação exige o mesmo header anti-CSRF administrativo das demais ações. Erros esperados de arquivo/binário/provider retornam mensagens acionáveis sanitizadas; erros inesperados continuam no error handler genérico do servidor.

## Garantias

- ausência de `fpcalc` não afeta scan, playback, MusicBrainz, artwork ou lyrics;
- ausência/desativação de AcoustID não afeta o fingerprint local nem o Assistente normal;
- nenhum path fornecido pelo cliente participa da execução;
- nenhuma chave é retornada ao frontend ou incorporada a cache key/log de request;
- nenhuma chamada de rede ocorre em testes;
- nenhuma tag ou arquivo de áudio é alterado;
- novas sugestões entram no lifecycle já existente de review/apply/stale.

## Testes

A cobertura dedicada inclui:

- runner fake de `fpcalc`, argumentos, parse e versão;
- erro, timeout, cancelamento e limite de saída;
- arquivo removido, arquivo não regular, symlink escape e confinement;
- cache hit e invalidação por mudança física;
- cascade do cache quando a faixa some;
- AcoustID fake para resposta válida, múltiplos candidatos, payload malformado e rate limit;
- segredo/fingerprint ausentes da URL e da cache key lógica;
- integração com o matcher existente;
- conflito externo/duração mantendo baixa confiança;
- múltiplas gravações mantendo ambiguidade;
- preservação de `albumArtist` sem evidência suficiente;
- client Web enviando somente os IDs necessários para a ação.
