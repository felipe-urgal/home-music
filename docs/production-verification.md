# Verificação de produção

O `prod:verify` do Home Music é uma validação somente leitura do endpoint canônico de readiness.

## Motivação

Depois de um restart do `home-music.service`, o processo pode levar alguns segundos para inicializar a biblioteca, preparar dependências de runtime e começar a aceitar conexões em `127.0.0.1:8787`. Um único `curl` imediatamente após o restart produz falso negativo durante essa janela, mesmo quando o serviço sobe corretamente logo em seguida.

## Contrato

`npm run prod:verify` executa `scripts/verify-production.mjs` e:

- consulta `http://127.0.0.1:8787/ready` por padrão;
- repete somente a consulta de readiness; nunca reinicia serviço nem repete deploy;
- usa prazo total padrão de 30 segundos;
- espera 1 segundo entre tentativas;
- limita cada request a 5 segundos;
- termina com código zero assim que o endpoint responde com status 2xx;
- termina com código diferente de zero se o readiness não ficar disponível dentro do prazo.

A janela pode ser ajustada operacionalmente sem alterar o contrato:

- `HOME_MUSIC_PRODUCTION_READY_URL` — URL de readiness;
- `HOME_MUSIC_VERIFY_TIMEOUT_MS` — prazo total;
- `HOME_MUSIC_VERIFY_INTERVAL_MS` — intervalo entre tentativas;
- `HOME_MUSIC_VERIFY_REQUEST_TIMEOUT_MS` — timeout de cada request.

Essas variáveis não devem ser usadas para mascarar um startup quebrado. Se o verify continuar falhando depois da janela, confira `systemctl status home-music --no-pager` e `journalctl -u home-music -n 100 --no-pager` antes de qualquer recuperação manual.

## Relação com o Dev Dashboard

O dashboard pode reexecutar somente `verify` quando a timeline comprovar que as etapas anteriores, incluindo `deploy`, terminaram com sucesso e que a única falha foi a validação final. Essa ação não repete `check`, `backup`, migration ou `deploy`.
