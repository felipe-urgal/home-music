# Tailscale + HTTPS

O perfil remoto mais restrito do Home Music usa **Tailscale Serve**. Nesse modo o Home Music continua privado ao tailnet e não exige port-forwarding no roteador.

Se a prioridade for acessar pelo Safari/Chrome **sem instalar Tailscale no celular**, existe também um perfil público opcional via **Tailscale Funnel**. Ele está documentado separadamente em [`public-access.md`](public-access.md).

```text
iPhone / Android / notebook com Tailscale
        |
        | HTTPS :443 (*.ts.net)
        | WireGuard/Tailscale
        v
    tailscaled / Serve
        |
        | HTTP apenas no loopback
        v
  127.0.0.1:8787 Fastify
        |
        +-- React dist
        +-- /api
        +-- SQLite + MUSIC_DIR
```

## Serve privado x Funnel público

- **Serve** publica o serviço somente para dispositivos/usuários autorizados no tailnet.
- **Funnel** torna a URL acessível pela internet pública; use somente quando quiser acesso sem cliente Tailscale no celular.
- os dois modos mantêm o Fastify em `127.0.0.1`, sem publicar `8787` diretamente;
- os dois modos terminam HTTPS no Tailscale e usam `HOME_MUSIC_COOKIE_SECURE=true`;
- o login próprio do Home Music continua ativo em ambos;
- Serve e Funnel não podem ocupar HTTPS/443 ao mesmo tempo; os scripts de operação fazem a transição explicitamente.

Para uso cotidiano mais fechado, prefira Serve. Para o perfil público sem cliente móvel, use `npm run tailscale:public:enable` e siga [`public-access.md`](public-access.md).

## Pré-requisitos do Serve privado

1. Home Music instalado como serviço (`npm run service:install`).
2. Tailscale instalado e autenticado no Ubuntu.
3. Tailscale instalado e autenticado no celular com uma identidade autorizada no mesmo tailnet.
4. MagicDNS habilitado.
5. HTTPS Certificates habilitado no tailnet.

A documentação oficial do Tailscale para Linux aceita:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Se preferir não usar `curl | sh`, use o repositório oficial de pacotes do Tailscale para a sua versão do Ubuntu.

### Atenção ao nome da máquina

Certificados `*.ts.net` são certificados públicos. O conteúdo e o acesso via Serve continuam privados, mas o **nome DNS do certificado** pode aparecer em logs públicos de Certificate Transparency.

Antes de habilitar HTTPS, use um nome de máquina que não revele informação sensível. Um nome simples como `home-music` é adequado. O nome pode ser ajustado na página **Machines** do painel do Tailscale.

## Habilitar Serve privado

Depois que o Tailscale estiver conectado:

```bash
npm run tailscale:enable
```

O script é conservador e executa as etapas nesta ordem:

1. valida Tailscale, versão, MagicDNS/DNS name e serviço systemd;
2. recusa substituir uma configuração existente em HTTPS/443 que não pertença ao Home Music;
3. confirma que o Home Music responde localmente;
4. configura `tailscale serve --bg` em HTTPS/443 apontando para `127.0.0.1:8787`;
5. valida o HTTPS real **antes** de fechar o acesso LAN;
6. altera `.env` para `PRODUCTION_HOST=127.0.0.1` e `HOME_MUSIC_COOKIE_SECURE=true`;
7. reinicia o serviço e valida `/health` e `/ready` novamente;
8. em caso de falha durante a transição, restaura o `.env` anterior e remove o Serve recém-criado.

A configuração `--bg` persiste após reboot e também volta depois de `tailscale down`/`tailscale up`.

No final, o script imprime uma URL semelhante a:

```text
https://home-music.seu-tailnet.ts.net
```

Use essa URL no celular enquanto ele estiver conectado ao Tailscale.

## Conferir status

```bash
npm run tailscale:status
```

Também são úteis:

```bash
tailscale status
tailscale serve status
sudo systemctl status home-music --no-pager
journalctl -u home-music -f
```

O estado esperado do perfil privado é:

```text
PRODUCTION_HOST=127.0.0.1
HOME_MUSIC_COOKIE_SECURE=true
Serve HTTPS/443 -> http://127.0.0.1:8787
```

## Teste no celular

Com Wi-Fi desligado e 4G/5G ativo:

1. conecte o app do Tailscale;
2. abra a URL HTTPS `*.ts.net` impressa pelo comando de setup;
3. faça login no Home Music;
4. navegue por uma pasta grande;
5. inicie uma música e teste play/pause, seek e próxima faixa;
6. bloqueie a tela e confirme Media Session;
7. confirme que capas e streaming continuam carregando.

Se o Tailscale do celular for desconectado, a URL privada deixa de ficar acessível. Isso é esperado. Se quiser que a mesma URL funcione sem o cliente móvel, migre conscientemente para Funnel com `npm run tailscale:public:enable`.

## Controle de acesso no tailnet

O login do Home Music não substitui as regras de rede do perfil Serve. Para um tailnet com várias pessoas ou dispositivos, aplique **least privilege** no Tailscale.

A recomendação atual do Tailscale é usar **grants** para novas políticas. Para transformar o Ubuntu em um servidor com identidade própria, você pode atribuir a ele uma tag como `tag:home-music` e permitir apenas HTTPS/443 a usuários específicos.

Exemplo conceitual de política (substitua a identidade pela sua):

```jsonc
{
  "tagOwners": {
    "tag:home-music": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["SEU_USUARIO_OU_GRUPO"],
      "dst": ["tag:home-music"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Aplicar uma tag muda a identidade Tailscale do dispositivo; faça essa etapa conscientemente pelo painel de administração e valide o acesso depois. Em um tailnet estritamente pessoal, você pode começar sem tag e endurecer a policy em seguida.

Nunca crie uma regra ampla para expor `8787`: o backend deve permanecer somente em loopback.

> Grants controlam o acesso dentro do tailnet/Serve. Eles não transformam Funnel em um endpoint privado: quando Funnel está ativo, o serviço está intencionalmente acessível pela internet pública e a proteção de aplicação é o login do Home Music.

## Atualizações futuras do Home Music

Tailscale Serve e Funnel são independentes do deploy da aplicação. Depois de um merge:

```bash
git checkout main
git pull --ff-only
npm run service:update
```

O `service:update` reconstrói e reinicia o Home Music, mas preserva a configuração persistente do Tailscale. A URL HTTPS permanece a mesma enquanto o nome da máquina/tailnet não mudar.

## Rollback para LAN

Se estiver no **Serve privado** e for necessário voltar temporariamente ao HTTP local:

```bash
npm run tailscale:disable
```

O comando só remove HTTPS/443 se a configuração Serve corresponder exatamente ao proxy do Home Music. Depois restaura:

```env
PRODUCTION_HOST=0.0.0.0
HOME_MUSIC_COOKIE_SECURE=false
```

O acesso volta a ser:

```text
http://IP_DO_PC:8787
```

Esse modo não é criptografado. Não faça port-forwarding da porta `8787` para a internet.

Se Funnel estiver ativo, primeiro execute:

```bash
npm run tailscale:public:disable
```

Esse comando remove a exposição pública e restaura Serve privado. Depois, se ainda quiser LAN HTTP, execute `npm run tailscale:disable`.

## Troubleshooting

### `Tailscale não encontrado`

Instale o cliente oficial e execute:

```bash
sudo tailscale up
```

### `BackendState` não está `Running`

Confira:

```bash
tailscale status
sudo systemctl status tailscaled --no-pager
```

### Serve não consegue habilitar HTTPS

No painel do Tailscale, abra **DNS** e confirme:

- MagicDNS habilitado;
- HTTPS Certificates habilitado.

Depois rode novamente:

```bash
npm run tailscale:enable
```

### Já existe configuração em HTTPS/443

Os scripts param sem sobrescrever uma configuração desconhecida. Inspecione:

```bash
tailscale serve status
tailscale funnel status
```

Decida conscientemente qual serviço deve ocupar 443 antes de continuar.

### Home Music responde localmente, mas não pelo celular no Serve

Confira se:

- o Tailscale está conectado nos dois dispositivos;
- a policy/grant permite acesso ao Ubuntu na porta 443;
- `tailscale serve status` aponta para `127.0.0.1:8787`;
- `/ready` está positivo;
- o disco de músicas está montado.

### Quero acessar sem Tailscale no celular

Não abra `8787` no roteador. Use o perfil Funnel documentado em [`public-access.md`](public-access.md):

```bash
npm run tailscale:public:enable
```
