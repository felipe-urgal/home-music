# Tailscale + HTTPS

O acesso remoto recomendado do Home Music usa **Tailscale Serve**. O Home Music continua privado ao tailnet e não exige port-forwarding no roteador.

```text
iPhone / Android / notebook
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

## Por que Serve e não Funnel

- **Serve** publica o serviço somente para dispositivos/usuários autorizados no tailnet.
- **Funnel** torna o serviço acessível pela internet pública e não é usado pelo Home Music.
- o Fastify fica em `127.0.0.1`, então a porta `8787` deixa de aceitar conexões diretas da LAN ou do tailnet;
- o navegador fala HTTPS com o Tailscale e o proxy local fala HTTP com o Fastify;
- `HOME_MUSIC_COOKIE_SECURE=true` mantém o cookie de sessão restrito a HTTPS;
- o login do próprio Home Music continua ativo como uma segunda camada de proteção.

## Pré-requisitos

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

Certificados `*.ts.net` são certificados públicos. O conteúdo e o acesso ao Home Music continuam privados, mas o **nome DNS do certificado** fica registrado em logs públicos de Certificate Transparency.

Antes de habilitar HTTPS, use um nome de máquina que não revele informação sensível. Um nome simples como `home-music` é adequado. O nome pode ser ajustado na página **Machines** do painel do Tailscale.

## Habilitar

Depois que o Tailscale estiver conectado:

```bash
npm run tailscale:enable
```

O script é conservador e executa as etapas nesta ordem:

1. valida Tailscale, versão, MagicDNS/DNS name e serviço systemd;
2. recusa substituir uma configuração Serve existente em HTTPS/443 que não pertença ao Home Music;
3. confirma que o Home Music responde localmente;
4. configura `tailscale serve --bg` em HTTPS/443 apontando para `127.0.0.1:8787`;
5. valida o HTTPS real **antes** de fechar o acesso LAN;
6. altera `.env` para `PRODUCTION_HOST=127.0.0.1` e `HOME_MUSIC_COOKIE_SECURE=true`;
7. reinicia o serviço e valida `/health` e `/ready` novamente;
8. em caso de falha durante a transição, restaura o `.env` anterior e remove o Serve recém-criado.

A configuração `--bg` do Tailscale Serve persiste após reboot e também volta depois de `tailscale down`/`tailscale up`.

No final, o script imprime uma URL semelhante a:

```text
https://home-music.seu-tailnet.ts.net
```

Use sempre essa URL no celular. Não use mais `http://IP_DO_PC:8787` como acesso cotidiano depois de habilitar o perfil Tailscale.

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

O estado esperado do Home Music é:

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

Se o Tailscale do celular for desconectado, a URL deixa de ficar acessível. Isso é esperado.

## Controle de acesso no tailnet

O login do Home Music não substitui as regras de rede. Para um tailnet com várias pessoas ou dispositivos, aplique **least privilege** no Tailscale.

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

## Atualizações futuras do Home Music

O Tailscale Serve é independente do deploy da aplicação. Depois de um merge:

```bash
git checkout main
git pull --ff-only
npm run service:update
```

O `service:update` reconstrói e reinicia o Home Music, mas preserva a configuração do Tailscale. A URL HTTPS permanece a mesma enquanto o nome da máquina/tailnet não mudar.

## Rollback para LAN

Se for necessário voltar temporariamente ao HTTP local:

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

### Já existe Serve em HTTPS/443

O script para sem sobrescrever a configuração existente. Inspecione:

```bash
tailscale serve status
tailscale serve status --json
```

Decida manualmente qual serviço deve ocupar 443 antes de continuar.

### Home Music responde localmente, mas não pelo celular

Confira se:

- o Tailscale está conectado nos dois dispositivos;
- a policy/grant permite acesso ao Ubuntu na porta 443;
- `tailscale serve status` aponta para `127.0.0.1:8787`;
- `/ready` está positivo;
- o disco de músicas está montado.
