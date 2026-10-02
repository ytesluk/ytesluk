# WCO — WhatsApp Cost Optimizer

Camada intermediária entre o sistema da empresa (ERP, e-commerce, CRM, app) e a **WhatsApp Business
Platform Cloud API** da Meta. O sistema de origem envia *eventos de negócio* (`order.status`,
`payment.approved`, `authentication.otp`…); o WCO decide **se, quando, como e quantas** mensagens
enviar para reduzir o custo total de WhatsApp — sem burlar cobrança, política, consentimento ou
classificação da Meta — e prova a economia com evidência auditável.

> **Status:** projeto completo e executável em modo **MOCK** (sem credenciais da Meta). Os valores de
> preço embarcados são **DEMO (fictícios)**; para custos reais importe o rate card oficial da Meta
> (`pnpm pricing import`). Toda simulação é rotulada como estimativa — nunca economia garantida.

## O que o WCO faz

| Técnica | Efeito | Exemplo |
|---|---|---|
| Deduplicação + idempotência | o mesmo evento nunca vira duas mensagens | integração reenviou `payment.approved` |
| Supersession | estados intermediários não enviados são substituídos pelo mais recente | CRIADO → PAGO → SEPARADO → ENVIADO ⇒ 1 mensagem "ENVIADO" |
| Debounce limitado | espera curta (por tipo de evento) para agrupar rajadas, nunca além do prazo | 30 s de debounce, 60 s de atraso máximo |
| Consolidação | atualizações compatíveis (mesma categoria, template-resumo **aprovado**) viram 1 mensagem | pagamento + rastreio do mesmo pedido |
| Agendamento ciente de janelas | usa janelas gratuitas **já abertas** (Free Entry Point, atendimento) e a cota grátis | follow-up dentro da FEP de 72 h |
| Preço versionado | regras da Meta por data de vigência, mercado do **destinatário**, tiers marginais | out/2026: Service passa a ser cobrada |
| Cloud API direta vs BSP | separa custo Meta, taxa de BSP e infraestrutura | braço F do experimento |

Nunca atrasa OTP/autenticação, fraude, segurança, mensagens críticas/urgentes/legais ou
`mustSendImmediately`. Nunca converte Marketing em Utility nem sugere alterar texto para mudar categoria
("Final category is determined by Meta").

## Resultado da simulação obrigatória (100.000 eventos, tarifas DEMO)

Mesmo dataset reprocessado em seis braços (detalhes em [`reports/final-100k/REPORT.md`](reports/final-100k/REPORT.md)):

| Braço | Técnicas | Mensagens | Custo Meta | Custo total | Economia total |
|---|---|---:|---:|---:|---:|
| A | controle (sem WCO) | 96.320 | R$ 8.952,92 | R$ 9.853,02 | — |
| B | deduplicação | 91.701 | R$ 8.257,39 | R$ 9.089,64 | 7,75% |
| C | + supersession | 82.635 | R$ 7.895,12 | R$ 8.690,69 | 11,80% |
| D | + consolidação | 73.655 | R$ 7.534,09 | R$ 8.293,10 | 15,83% |
| E | + otimizador de preço | 73.655 | R$ 7.386,51 | R$ 8.130,76 | 17,48% |
| F | E + Cloud API direta (sem BSP hipotético de 10%) | 73.655 | R$ 7.386,51 | R$ 7.392,11 | 24,98% |

Valores **simulados com rate card DEMO**; servem para comparar técnicas, não para prometer economia.
A matriz científica (9 cenários × 2 tamanhos × 3 seeds, 54/54 execuções com economia positiva) e a
execução de 1 milhão de eventos estão em [`reports/research`](reports/research/REPORT.md) e
[`reports/research-1m`](reports/research-1m/REPORT.md).

## Início rápido

### Docker (stack completo)

```bash
docker compose up -d --build
# Dashboard: http://localhost:3000   ·   API/OpenAPI: http://localhost:4000/api/docs
# Login (dev): owner@loja-demo.wco.dev / wco-demo-2026!   (também admin@, analyst@, operator@)
API_URL=http://localhost:4000 pnpm smoke     # teste de fumaça ponta a ponta contra o stack
```

### Desenvolvimento local

Requisitos: Node ≥ 22.12, pnpm 10, PostgreSQL 16, Redis 7.

```bash
pnpm install
cp .env.example .env                 # MOCK_WHATSAPP=true por padrão
pnpm db:migrate && pnpm db:seed      # schema + dados de demonstração
pnpm dev                             # API :4000, worker, dashboard :3000
```

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | API, worker e dashboard em modo watch |
| `pnpm test` | testes unitários (preço, otimização, provedores, segurança, simulador) |
| `pnpm test:integration` / `pnpm test:e2e` | PostgreSQL + Redis reais; E2E sobe API + workers em processo |
| `pnpm test:web` | Playwright no dashboard (requer stack rodando) |
| `pnpm lint` · `pnpm typecheck` · `pnpm build` | qualidade e build de produção |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` | banco |
| `pnpm pricing <cmd>` | `policies`, `list`, `validate`, `import`, `retire`, `export-demo`, `estimate` |
| `pnpm simulate` | simulação final de 100k eventos → `reports/final-100k/` |
| `pnpm generate` | datasets sintéticos 10k/50k/100k (e 1M com `--sizes 1000000`) |
| `pnpm research` | matriz do experimento acadêmico A–F → `reports/research/` |
| `pnpm smoke` | verificação ponta a ponta contra uma implantação em execução |

## Estrutura

```
apps/
  api/        Fastify REST API (auth, RBAC, OpenAPI, webhooks da Meta)
  worker/     BullMQ: otimização, flush do buffer, envio, webhooks, manutenção
  web/        Next.js 16 + Tailwind 4 (dashboard; BFF com sessão httpOnly)
packages/
  domain/     tipos, enums, dinheiro (Decimal), tempo/fuso, mercados, RBAC, máquina de estados
  pricing/    políticas versionadas, rate cards, TierCalculator, CostEngine, importador
  policy/     políticas de otimização por evento, PolicyEngine declarativo, retenção
  optimization/ dedup, supersession, debounce, consolidação, scheduler, decisão, pipeline em memória
  whatsapp/   WhatsAppProvider: MetaCloudApiProvider (Graph API versionada) e MockWhatsAppProvider
  database/   Prisma 7 (PostgreSQL), migrações, guard de tenant, repositório de preços
  services/   casos de uso compartilhados por API e worker
  simulator/  datasets, experimento A–F, varreduras, gráficos SVG, relatórios
  config/ logging/ testing/
scripts/      seed, simulate, generate, research, pricing, smoke
docs/         documentação (abaixo)
reports/      resultados gerados (final-100k, research, research-1m)
infra/docker/ Dockerfile multi-target, secrets
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Desenvolvimento](docs/DEVELOPMENT.md) · [Implantação](docs/DEPLOYMENT.md)
- [Preços](docs/PRICING.md) · [Motor de cobrança](docs/BILLING-ENGINE.md) · [Motor de otimização](docs/OPTIMIZATION-ENGINE.md) · [Webhooks](docs/WEBHOOKS.md)
- [Segurança](docs/SECURITY.md) · [LGPD](docs/LGPD.md) · [Limitações](docs/LIMITATIONS.md)
- [Fontes da Meta consultadas](docs/META-SOURCES.md) · [Conflitos conhecidos](docs/KNOWN-CONFLICTS.md) · [Configurar a Meta](docs/SETUP-META.md)
- [Experimento acadêmico](docs/ACADEMIC-EXPERIMENT.md)

## Princípios

1. Regras de preço são **dados versionados** com fonte citada; histórico nunca é recalculado.
2. Mercado = código de discagem do **destinatário**; datas de cobrança no fuso da WABA.
3. "Economizado" só com evidência: estimado ≠ realizado ≠ desconhecido; Meta, BSP e infraestrutura separados.
4. Nada de LLM no caminho quente; o assistente de classificação é opcional, desligado e nunca decide a categoria.
5. Segredos criptografados (AES-256-GCM), telefones por hash/máscara, logs sem PII nem conteúdo.
