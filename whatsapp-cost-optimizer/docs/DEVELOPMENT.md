# Desenvolvimento

## Ambiente

* Node ≥ 22.12, pnpm 10.28, PostgreSQL 16, Redis 7 (ou `docker compose up -d postgres redis`).
* TypeScript 6 em modo estrito; pacotes do workspace exportam código-fonte TS (sem build intermediário);
  apps são empacotados com `tsup` (API/worker) e `next build` (web).

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev                     # ou: pnpm dev:api · pnpm dev:worker · pnpm dev:web
```

Usuários de demonstração (seed): `owner@`, `admin@`, `analyst@`, `operator@loja-demo.wco.dev` e
`…@acme.wco.dev`, senha `wco-demo-2026!`. API keys de desenvolvimento são impressas pelo seed.

## Testes

| Comando | Escopo | Infra |
|---|---|---|
| `pnpm test` | unitários: preço (políticas, janelas, cota, tiers, mercados, importador), otimização (casos 1–4, §63, consentimento, janelas), provedores (Meta/Mock, webhooks, erros, circuit breaker), simulador, logging, segurança | nenhuma |
| `pnpm test:integration` | isolamento de tenant (caso 9), webhook duplicado (caso 10), assinatura, realização de custo pela Meta, LGPD | PostgreSQL + Redis (`wco_test`, Redis DB 15) |
| `pnpm test:e2e` | API HTTP + workers BullMQ em processo: auth/RBAC, validação, casos 1–4, idempotência, isolamento, webhooks, rate limit | PostgreSQL + Redis |
| `pnpm test:web` | Playwright no dashboard (login, KPIs, simulador, auditoria, RBAC na navegação) | stack rodando + seed |
| `pnpm smoke` | verificação ponta a ponta contra uma implantação | stack rodando |

Variáveis: `TEST_DATABASE_URL` (padrão `postgresql://wco:wco@localhost:5432/wco_test`), `TEST_REDIS_URL`,
`WEB_URL`, `PLAYWRIGHT_CHROMIUM_PATH`.

## Qualidade

```bash
pnpm lint          # ESLint (typescript-eslint), sem `any`, sem console fora de scripts/testes
pnpm typecheck     # todos os pacotes e apps (gera o Prisma client antes)
pnpm build         # Prisma generate + tsup (api, worker) + next build (web)
pnpm format        # Prettier
```

## Banco

* Schema: `packages/database/prisma/schema.prisma`; config: `packages/database/prisma.config.ts`.
* Nova migração: `pnpm db:migrate:dev --name <nome>`; client: `pnpm db:generate`.
* Gerador `prisma-client` (ESM) com `@prisma/adapter-pg`; ids `uuid(7)`; dinheiro `Decimal(18,8)`.

## Convenções

* Regras de preço só em `PolicyDefinition` (dados), nunca `if (data > …)` espalhado.
* Toda chamada HTTP à Meta passa por `WhatsAppProvider`; versão da Graph API só via configuração.
* Serviços sempre recebem `tenantId` da credencial e filtram por ele.
* Valores monetários com `Money`/`Decimal`; datas de cobrança com `localDate(instante, fusoDaWaba)`.
* Mensagens e explicações exibidas ao usuário em português; códigos de motivo estáveis em inglês
  (`duplicate_event`, `free_entry_point_window`…) para auditoria e métricas.

## Simulação e pesquisa

```bash
pnpm simulate                                   # 100k eventos, A–F + varreduras → reports/final-100k
pnpm simulate --events 20000 --no-sweeps        # rápido → reports/runs/
pnpm generate --sizes 10000,50000 --scenarios HIGH_FEP
pnpm research --sizes 10000 --seeds 1           # matriz reduzida
pnpm research --sizes 1000000 --scenarios MEDIUM_DUPLICATION --seeds 1 --out reports/research-1m
```
