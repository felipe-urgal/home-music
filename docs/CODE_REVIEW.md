# Guia de Code Review

Review deve priorizar correção, segurança, clareza, testabilidade e simplicidade.

## Princípio

KISS prevalece sobre aplicação mecânica de SOLID. Abstração só é ganho quando reduz acoplamento, repetição relevante ou risco real.

## S — Single Responsibility

Procure unidades que misturem UI, IO, regra e formatação. Pergunta: "Essa lógica tem um owner claro?"

## O — Open/Closed

Observe if/else ou switch que crescem para cada variante. Só introduza estratégia ou registry quando a variação for real e recorrente.

## L — Liskov Substitution

Contratos compartilhados devem manter expectativas compatíveis. Evite implementações que exigem tratamento especial.

## I — Interface Segregation

Não force consumidores a depender de objetos, props ou métodos que não usam.

## D — Dependency Inversion

Isole integrações externas quando isso proteger regra de negócio. Não crie wrappers sem benefício concreto.

## Checklist

- [ ] Resolve exatamente o problema proposto.
- [ ] Preserva comportamento fora do escopo.
- [ ] Trata erros e regressões relevantes.
- [ ] Não cria abstração sem necessidade concreta.
- [ ] Mantém responsabilidades claras.
- [ ] Testa o comportamento importante no nível adequado.
- [ ] Considera segurança, autorização, IO e performance quando aplicável.
- [ ] O diff final foi revisado.
