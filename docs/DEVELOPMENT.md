# Desenvolvimento

## Preparação

Requisitos principais:

- Node.js compatível com o package.json
- npm
- biblioteca de áudio local para fluxos de mídia

Instalação e execução:

    npm ci
    npm run dev

## Relação com o agent-orchestrator

Quando uma mudança for coordenada pelo `agent-orchestrator`, este documento continua sendo a fonte local para preparação, desenvolvimento e validação do projeto. Ele não substitui a task canônica nem define workflow, handoff ou autorizações.

## Fluxo de alteração

1. Localize o owner real da responsabilidade.
2. Defina critérios de aceite para mudanças não triviais.
3. Faça a menor alteração coerente.
4. Ajuste testes no nível adequado.
5. Execute o gate e revise o diff.

## Validação

Gate canônico:

    npm run check

Comandos úteis:

    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npm run test:security
    npm run smoke:production

Use suites caras apenas quando o risco da mudança justificar.

## Segurança e operação

- Não commite credenciais, chaves ou tokens.
- Preserve isolamento entre usuários.
- Valide caminhos antes de operações de arquivo.
- Não exponha o serviço local diretamente à internet.
- Mudanças operacionais devem manter possibilidade clara de rollback.

## Política de documentação

Mantenha somente documentação viva. Planos concluídos, decisões pontuais e relatórios ficam no histórico Git, issues e PRs.
