# Acesso HTTPS sem cliente Tailscale no celular

Este perfil é opcional e usa **Tailscale Funnel** para permitir acesso ao Home Music pelo Safari/Chrome sem instalar ou conectar o Tailscale no celular.

> Diferente do Tailscale Serve, o Funnel torna a URL do Home Music alcançável pela internet pública. A biblioteca e as APIs continuam protegidas pelo login próprio do Home Music, mas a tela de login passa a ser pública.

## Arquitetura

```text
Safari / Chrome em Wi-Fi, 4G ou 5G
        |
        | HTTPS :443 (*.ts.net)
        | internet pública
        v
  Tailscale Funnel
        |
        | HTTP somente em loopback
        v
  Fastify 127.0.0.1:8787
        |
        +-- React dist
        +-- /api autenticada
        +-- SQLite + MUSIC_DIR
```

A porta `8787` continua inacessível diretamente pela LAN e pela internet. Não é necessário port-forwarding no roteador.

## Quando usar

Use este modo quando a prioridade for abrir o Home Music de qualquer navegador móvel sem depender do aplicativo Tailscale.

Se a prioridade máxima for restringir o tráfego somente ao seu tailnet, continue usando o perfil privado com `npm run tailscale:enable`.

Tailscale Serve e Funnel não podem ocupar a mesma porta `443` ao mesmo tempo. O script faz a transição entre os dois modos conscientemente.

## Pré-requisitos

1. Home Music instalado como serviço (`npm run service:install`).
2. Tailscale instalado e autenticado **no Ubuntu**.
3. MagicDNS e HTTPS Certificates habilitados no tailnet.
4. Tailscale CLI 1.52 ou superior.
5. existir no SQLite uma conta `admin` ativa, sem troca obrigatória de senha pendente;
6. a senha atual desse administrador ter pelo menos **20 caracteres** para habilitar o perfil público;
7. build atual do Home Music disponível, pois o script usa o validador local de credenciais persistidas;
8. permissão para usar Funnel no tailnet.

`HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` não são requisitos do Funnel. Essas variáveis servem somente ao bootstrap do primeiro administrador e podem/deveriam ter sido removidas depois que a conta persistida foi validada.

O celular não precisa ter Tailscale instalado.

Se o CLI reclamar de permissão para alterar Serve/Funnel, autorize seu usuário uma vez:

```bash
sudo tailscale set --operator="$USER"
```

Na primeira ativação do Funnel, o Tailscale pode solicitar habilitação/ajuste da permissão de Funnel no tailnet. Conclua essa etapa no fluxo oficial do Tailscale e execute o comando novamente.

## Habilitar

```bash
npm run tailscale:public:enable
```

O comando solicita no terminal o **username e a senha atual de um administrador persistido**. A senha não é gravada no `.env`, no histórico operacional ou em argumentos de processo; ela é usada somente para validar localmente se a conta está ativa, é `admin`, não exige troca de senha e atende ao tamanho mínimo do perfil público.

Antes de publicar, o script:

1. valida serviço, Tailscale, MagicDNS, porta e build necessário ao validador local;
2. valida a conta administrativa persistida e recusa senha com menos de 20 caracteres;
3. recusa sobrescrever outro serviço já configurado em HTTPS/443;
4. confirma que o Home Music responde localmente;
5. altera `PRODUCTION_HOST=127.0.0.1`, `HOME_MUSIC_COOKIE_SECURE=true` e a confiança restrita no proxy Tailscale necessária ao perfil;
6. reinicia e valida o backend **antes** de criar o Funnel;
7. cria Funnel persistente em HTTPS/443 apontando somente para `127.0.0.1:8787`;
8. confirma que a configuração final é realmente Funnel para o backend esperado;
9. valida `/ready` pela URL HTTPS.

Se qualquer etapa falhar, o script remove o Funnel recém-criado, restaura o `.env` anterior e, quando o ponto de partida era Tailscale Serve, restaura o Serve privado.

No final será exibida uma URL semelhante a:

```text
https://home-music.seu-tailnet.ts.net
```

Essa URL pode ser aberta diretamente no Safari/Chrome usando Wi-Fi, 4G ou 5G, sem Tailscale no celular.

## Status

```bash
npm run tailscale:public:status
```

Estados esperados:

- `publico-funnel`: público via Funnel, backend em loopback, cookie Secure e proxy Tailscale confiado pela configuração esperada;
- `privado-serve`: privado ao tailnet via Serve;
- `lan-http`: sem proxy Tailscale em 443 e backend exposto apenas na LAN;
- `hostname-renomeado`: o MagicDNS atual mudou, mas existe uma configuração persistente exclusiva do Home Music no hostname anterior;
- `inconsistente`: configuração de rede e `.env` não combinam; revise antes de continuar.

Também podem ajudar:

```bash
tailscale funnel status
tailscale serve status
sudo systemctl status home-music --no-pager
journalctl -u home-music -f
```

## Renomear a máquina Tailscale

Ao executar algo como:

```bash
sudo tailscale set --hostname=home-music
```

o MagicDNS passa a usar o hostname novo, mas versões/configurações persistentes do Serve/Funnel podem continuar registradas no hostname anterior. Nesse caso, um `tailscale funnel --https=443 off` direcionado ao hostname atual pode responder `handler does not exist` mesmo com o Funnel antigo ainda ativo.

Os comandos `tailscale:public:status`, `tailscale:public:enable` e `tailscale:public:disable` detectam esse caso comparando o hostname presente em `tailscale serve status --json` com o MagicDNS atual.

A migração automática usa `tailscale funnel reset` ou `tailscale serve reset` **somente** quando o script prova que toda a configuração persistente do nó pertence exclusivamente ao Home Music: uma única porta `443`, um único handler `/` e o proxy esperado `127.0.0.1:PORT`. Se existir qualquer porta, rota ou handler adicional, a operação aborta sem reset para não apagar configuração de outro serviço.

Depois de um rename, você pode executar normalmente:

```bash
npm run tailscale:public:status
npm run tailscale:public:disable
# ou, se quiser continuar público no hostname novo:
npm run tailscale:public:enable
```

Se a limpeza da configuração antiga falhar, o script não assume que a exposição foi fechada. Para Funnel, ele avisa explicitamente que a URL antiga pode continuar pública e pede conferência com `tailscale funnel status`.

## Voltar ao modo privado

```bash
npm run tailscale:public:disable
```

Esse comando **não volta para HTTP/LAN**. Ele remove o Funnel e restaura automaticamente o Tailscale Serve privado em HTTPS/443, mantendo:

```env
PRODUCTION_HOST=127.0.0.1
HOME_MUSIC_COOKIE_SECURE=true
```

Assim, se você desistir do acesso público, o fallback continua criptografado e restrito ao tailnet.

Para voltar deliberadamente ao HTTP da LAN, use o fluxo antigo depois que o Funnel estiver desativado:

```bash
npm run tailscale:disable
```

## Segurança

O modo público preserva as proteções existentes do Home Music:

- autenticação própria antes de qualquer API privada;
- sessão aleatória em cookie `HttpOnly`, `SameSite=Strict` e `Secure`;
- header anti-CSRF nas mutações;
- rate limit de tentativas inválidas de login;
- CSP e headers de hardening;
- paths físicos da biblioteca não expostos;
- backend restrito ao loopback;
- nenhuma porta do roteador é aberta.

Ainda assim, há uma diferença fundamental: com Funnel, qualquer pessoa na internet pode alcançar a URL e tentar autenticar. Por isso:

- use uma senha exclusiva e longa; o script exige no mínimo 20 caracteres no administrador usado para autorizar a exposição;
- não reutilize a senha de e-mail, GitHub, Tailscale ou outros serviços;
- mantenha Ubuntu, Node, dependências e Tailscale atualizados;
- se não precisar do acesso público por um período, execute `npm run tailscale:public:disable`;
- nunca faça port-forwarding de `8787`.

Funnel possui limites de banda definidos pelo próprio Tailscale. Para streaming pessoal isso pode ser suficiente, mas não é um serviço de distribuição pública de mídia.

## Teste no celular

1. execute `npm run tailscale:public:enable`;
2. confirme `npm run tailscale:public:status` com perfil `publico-funnel`;
3. desligue/desinstale o Tailscale do celular ou simplesmente não o conecte;
4. desligue o Wi-Fi para forçar 4G/5G;
5. abra a URL `https://*.ts.net`;
6. faça login;
7. teste biblioteca, capas, play/pause, seek e próxima faixa;
8. bloqueie a tela e valide Media Session;
9. teste uma faixa transcodificada em modo Economia;
10. ao terminar, mantenha o Funnel ativo somente se quiser acesso público contínuo.

## Certificate Transparency

Assim como no Serve, o certificado HTTPS usa o hostname `*.ts.net`. O hostname do certificado pode aparecer em logs públicos de Certificate Transparency. Use um nome de máquina que não revele informação sensível.
