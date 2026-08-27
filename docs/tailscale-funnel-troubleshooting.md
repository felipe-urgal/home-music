# Tailscale Funnel — diagnóstico de acesso público

Este runbook registra o procedimento usado para diagnosticar quando o Home Music está saudável em produção, o Tailscale informa `Funnel on`, mas o PWA/navegador fora da máquina não consegue abrir a URL pública.

## Sintoma observado

Em 2026-08-27 foi observado o seguinte cenário:

- `home-music.service` estava `active (running)`;
- `http://127.0.0.1:8787/ready` retornava `HTTP 200` com `{"ready":true}`;
- `npm run tailscale:public:status` mostrava o perfil `publico-funnel`;
- `tailscale funnel status` mostrava `https://<host>.ts.net` com proxy para `http://127.0.0.1:8787`;
- mesmo assim, Safari/PWA no celular informava que o Home Music estava offline.

A conclusão importante é que **backend saudável + `Funnel on` não prova sozinho que o caminho público do Funnel está funcional**.

## 1. Validar o backend primeiro

Antes de mexer no Funnel, confirme o serviço local:

```bash
systemctl is-active home-music
curl -i http://127.0.0.1:8787/ready
npm run tailscale:public:status
```

O esperado é:

- serviço `active`;
- `/ready` com `HTTP 200`;
- backend esperado em `127.0.0.1:8787`;
- perfil `publico-funnel` quando a exposição pública estiver habilitada.

Se `/ready` local falhar, o problema é do Home Music e deve ser resolvido antes de investigar o Funnel.

## 2. Não confundir MagicDNS privado com o caminho público

Na própria máquina conectada à tailnet, o hostname `*.ts.net` pode resolver para o IP privado Tailscale `100.x.x.x` via MagicDNS.

Por isso, um comando como:

```bash
curl -Iv https://<host>.ts.net
```

pode testar apenas o caminho privado da tailnet e **não atravessar o relay público do Funnel**.

Esse detalhe também vale para validações automatizadas executadas na própria máquina: se a URL resolver para `100.x`, um `200` local não é evidência suficiente de que um dispositivo sem Tailscale consegue acessar o Funnel.

## 3. Consultar o DNS público

Consulte resolvedores públicos explicitamente:

```bash
dig @1.1.1.1 <host>.ts.net A +short
dig @8.8.8.8 <host>.ts.net A +short
```

O resultado público não deve ser o IP privado `100.x` do nó. Os endereços retornados podem mudar; não os registre como configuração fixa.

## 4. Testar o caminho público de verdade

Use os IPs retornados pelo DNS público para forçar o TLS/HTTP pelo relay público, mantendo o hostname correto para SNI e certificado.

Exemplo:

```bash
HOST="<host>.ts.net"
for IP in $(dig @1.1.1.1 "$HOST" A +short); do
  echo "==> Testando $IP"
  curl -Iv --max-time 15 \
    --resolve "$HOST:443:$IP" \
    "https://$HOST/ready"
done
```

Interpretação:

- `HTTP/2 200` ou `HTTP/1.1 200`: caminho público do Funnel alcançou o Home Music;
- erro de TLS como `unexpected eof while reading`, antes de qualquer resposta HTTP: a falha ocorreu no caminho público/TLS antes de chegar ao backend;
- resposta HTTP do Home Music: o Funnel chegou ao backend e o diagnóstico deve seguir pela aplicação/status retornado.

## 5. Confirmar Tailscale no host

Quando o caminho público falhar, registre também:

```bash
tailscale funnel status
tailscale status
sudo systemctl status tailscaled --no-pager
tailscale netcheck
journalctl -u tailscaled -n 150 --no-pager -l
```

Erros antigos de `dial tcp 127.0.0.1:8787: connect: connection refused` podem aparecer no journal se o Home Music ficou parado anteriormente. Correlacione sempre o timestamp antes de tratar essas linhas como falha atual.

## 6. Recovery controlado do Funnel

Se o backend local está saudável, a configuração do Funnel parece correta, mas o caminho público continua falhando, recrie a exposição usando os scripts do projeto em vez de comandos Tailscale manuais.

Primeiro desabilite o perfil público:

```bash
npm run tailscale:public:disable
```

Confirme o estado:

```bash
npm run tailscale:public:status
tailscale funnel status
```

Depois habilite novamente:

```bash
npm run tailscale:public:enable
```

O `enable` exige a confirmação com uma conta `admin` ativa e a senha atual dessa conta antes de tornar a tela de login acessível pela internet. Não registre username nem senha em logs, documentação ou histórico de comandos automatizados.

O fluxo `disable`/`enable` reinicia o serviço durante a mudança de perfil; sessões em memória podem ser invalidadas e um novo login pode ser necessário.

Depois de recriar o Funnel, repita obrigatoriamente o teste público com `dig` + `curl --resolve`. Não considere apenas o status local como validação final.

## 7. Resultado do incidente de 2026-08-27

No incidente que originou este runbook:

1. o backend local permaneceu saudável;
2. o Funnel aparecia como configurado e ativo;
3. o DNS público retornava relays públicos;
4. o teste forçado contra os relays apresentou falha TLS `unexpected eof while reading`;
5. o Funnel foi desabilitado e habilitado novamente pelo fluxo oficial do projeto;
6. o acesso público pelo celular voltou posteriormente.

O comportamento foi compatível com uma falha transitória no caminho público do Funnel, não com indisponibilidade do backend Home Music. A recriação da configuração coincidiu com a recuperação, mas não é possível atribuir causalidade com certeza somente a partir desse episódio.

## 8. Limitação conhecida da validação atual

O script `scripts/configure-funnel.sh` valida a URL HTTPS depois de habilitar o Funnel executando a requisição na própria máquina.

Como o MagicDNS local pode resolver o hostname para o IP Tailscale privado `100.x`, essa validação pode ficar verde mesmo quando o relay público está inacessível.

Portanto, até que exista um smoke público dedicado, o gate operacional completo para Funnel deve incluir:

```text
backend local /ready = 200
+ status Funnel esperado
+ DNS público válido
+ teste curl --resolve via relay público
+ teste final de um dispositivo fora da tailnet quando aplicável
```

## Checklist rápido

Quando o celular disser que o Home Music está offline:

```bash
systemctl is-active home-music
curl -i http://127.0.0.1:8787/ready
npm run tailscale:public:status
tailscale funnel status
dig @1.1.1.1 <host>.ts.net A +short
```

Se tudo acima estiver correto, teste os IPs públicos com `curl --resolve`. Só depois considere recriar o Funnel.

Não limpe dados do PWA como primeira tentativa: downloads offline são locais ao dispositivo e podem ser perdidos dependendo da limpeza realizada.
