# QA físico da TV

## Objetivo

Este roteiro concentra a homologação manual que não pode ser substituída por CI. Ele cobre:

- login da TV pelo celular;
- modo totalmente offline pela LAN;
- recuperação de conexão e falhas de rede.

Use sempre um APK produzido por um workflow Android TV verde no mesmo runtime que será homologado. Registre resultados e versões nas issues correspondentes; este documento deve permanecer apenas como roteiro vivo.

## Preparação

Antes de testar:

- instalar o APK atual no BTV;
- confirmar versão do Android/BTV e do GeckoView;
- registrar modelo e versão do celular;
- registrar browser e versão;
- deixar TV e celular na mesma LAN, sem VPN;
- ter pelo menos duas faixas baixadas no celular;
- confirmar que o Home Music abre normalmente com backend disponível;
- confirmar que a PWA já foi instalada/carregada antes do teste offline.

Não registrar QR, segredo, token, cookie ou conteúdo de credenciais em screenshots ou comentários.

## 1. Login da TV pelo celular

Relacionado à #428.

### Fluxo principal

1. Com backend e rede disponíveis, abrir o Home Music TV.
2. Selecionar **Entrar com o celular**.
3. Confirmar que a TV mostra QR e código curto.
4. Ler o QR no celular.
5. Se o celular estiver deslogado, autenticar e confirmar retorno automático à aprovação.
6. Comparar o código curto do celular com o código da TV.
7. Aprovar a entrada.
8. Confirmar que a TV entra sem digitar usuário ou senha no controle remoto.
9. Confirmar que o celular continua autenticado e utilizável.
10. Fazer logout somente na TV e verificar que a sessão do celular permanece ativa.

### Lifecycle

1. Entrar novamente pelo celular.
2. Fechar e reabrir o app da TV.
3. Confirmar se a sessão esperada permanece válida.
4. Reiniciar a BTV.
5. Abrir novamente o app e confirmar o comportamento esperado da sessão.

### Expiração e regeneração

1. Gerar um QR.
2. Gerar outro antes de aprovar o primeiro.
3. Confirmar que o QR anterior não consegue autorizar a TV.
4. Gerar novo QR e deixar a autorização expirar.
5. Confirmar que o QR expirado não cria sessão.
6. Gerar outro QR e concluir o login normalmente.

### Evidência mínima

Registrar na #428:

- versão do APK/commit testado;
- modelo/versão da BTV;
- modelo/versão do celular;
- browser usado;
- resultado do fluxo principal;
- resultado após fechar/reabrir;
- resultado após reiniciar;
- resultado de regeneração;
- resultado de expiração;
- qualquer divergência observada.

## 2. Modo totalmente offline pela LAN

Relacionado às #417 e #422.

### Pré-condição

1. Com backend disponível, abrir o Home Music no celular.
2. Confirmar duas faixas disponíveis offline.
3. Confirmar que o receiver offline da TV abre normalmente.
4. Desligar ou bloquear o acesso ao backend Home Music.
5. Desligar a WAN quando o cenário permitir.
6. Manter somente TV e celular na mesma LAN.

### Pareamento

1. Reiniciar ou reabrir o Home Music TV.
2. Entrar no receiver offline.
3. Gerar novo QR LAN.
4. Abrir o Home Music/PWA no celular sem restaurar o backend.
5. Escanear o QR dentro do fluxo do Home Music.
6. Observar o transporte usado:
   - iPhone/iPad: bridge LAN;
   - demais plataformas: transporte direto.
7. Quando houver Local Network Access, conceder a permissão.
8. Confirmar que o receiver abre automaticamente após o join autenticado.
9. Confirmar estabelecimento do WebRTC/DataChannel.

### Reprodução

1. Enviar a primeira faixa baixada.
2. Confirmar áudio na TV.
3. Confirmar título/estado de reprodução coerentes.
4. Exercitar pause e play.
5. Exercitar seek quando disponível.
6. Avançar para a segunda faixa.
7. Voltar para a faixa anterior quando disponível.
8. Confirmar que o celular não toca um segundo áudio local concorrente.
9. Confirmar que o backend permanece indisponível durante o fluxo.

### Background e lock

1. Com áudio tocando na TV, bloquear o celular por pelo menos 30 segundos.
2. Confirmar que um estado WebRTC `disconnected` transitório não destrói a sessão imediatamente.
3. Desbloquear o celular.
4. Confirmar retorno dos controles quando o peer recuperar `connected`.
5. Repetir colocando o browser/PWA em background e retornando.

### QR e sessão

1. Regenerar o QR.
2. Confirmar que o QR anterior deixa de funcionar.
3. Deixar um QR expirar.
4. Confirmar mensagem de expiração e necessidade de novo pareamento.
5. Fechar a sessão atual.
6. Confirmar que requests da sessão fechada não continuam válidos.

## 3. Cenários negativos

Execute quando a infraestrutura permitir.

| Cenário | Resultado esperado |
| --- | --- |
| Celular em outra rede | TV não alcançável; não transformar em erro de autenticação |
| AP/client isolation | falha de alcance LAN explícita |
| Local Network Access negado | mensagem distinta de TV não encontrada |
| QR expirado | solicitar novo QR |
| QR regenerado | sessão anterior rejeitada |
| Wi-Fi do celular desligado | perda real de conexão e recuperação por novo pareamento quando necessário |
| Receiver fechado | peer/sessão encerrados sem continuar aceitando comandos |
| TV troca de IP | QR antigo deixa de ser utilizável |
| Arquivo offline ausente | não iniciar reprodução inválida |
| Browser sem capacidade LAN necessária | informar limitação sem fallback inseguro |

## 4. Volta ao modo online

Depois dos testes offline:

1. Restaurar WAN e backend Home Music.
2. Reabrir a aplicação da TV.
3. Confirmar login online.
4. Confirmar biblioteca.
5. Confirmar reprodução normal.
6. Confirmar controle remoto online.
7. Confirmar que nenhum estado da sessão LAN anterior interfere no modo online.

## 5. Registro de resultado

Para cada execução física, registrar apenas:

```text
APK/commit:
BTV/Android:
GeckoView:
Celular/SO:
Browser/versão:
PWA instalada ou aba:
Rede/roteador:
Transporte LAN:
Login por celular: PASS / FAIL / N/A
Pareamento offline: PASS / FAIL / N/A
Duas faixas offline: PASS / FAIL / N/A
Controles: PASS / FAIL / N/A
Background/lock: PASS / FAIL / N/A
QR expirado/regenerado: PASS / FAIL / N/A
Falha de rede: PASS / FAIL / N/A
Retorno online: PASS / FAIL / N/A
Observações:
```

Não promover um item físico para suportado apenas porque o equivalente automatizado passou no CI.
