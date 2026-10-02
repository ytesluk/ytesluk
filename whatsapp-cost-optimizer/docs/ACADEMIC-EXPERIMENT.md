# Experimento acadêmico

**Título de trabalho:** *Otimização do custo de mensageria transacional no WhatsApp Business Platform
por deduplicação, supersessão, consolidação e agendamento ciente de janelas gratuitas.*

Todos os números abaixo foram produzidos pelos scripts do repositório (nenhum digitado à mão) e são
**simulados com o rate card DEMO** (valores fictícios). Servem para comparar técnicas entre si, não para
prometer economia em uma operação real.

## 1. Problema

Sistemas transacionais emitem um evento por mudança de estado e, tipicamente, uma mensagem por evento.
Rajadas de atualizações do mesmo pedido, reenvios de integração e mensagens fora de janelas gratuitas
geram custo evitável — cobrado por mensagem entregue, por categoria e por mercado do destinatário, com
tiers de volume e janelas gratuitas definidos pela Meta (fontes em META-SOURCES.md).

## 2. Hipóteses

* **H1** — Aplicar todas as técnicas (braço E) reduz o custo Meta em relação ao envio direto (A) no mesmo tráfego.
* **H2** — As técnicas são cumulativas: economia B ≤ C ≤ D ≤ E.
* **H3** — A economia cresce com a taxa de duplicação na origem, com a fração de atualizações em rajada e
  com a fração de conversas iniciadas por anúncio (Free Entry Point).
* **H4** — Separar custo Meta, BSP e infraestrutura muda a conclusão sobre "economia total" (F vs E).

## 3. Método

* **Desenho pareado**: para cada (cenário, tamanho, seed) um único dataset é gerado e reprocessado por
  todos os braços; diferenças vêm apenas das técnicas habilitadas.
* **Motor**: o mesmo código de produção (`OptimizationEngine`, `PolicyEngine`, `CostEngine`,
  `TierCalculator`) executado por um simulador de eventos discretos (`InMemoryPipeline`, fila de
  prioridade por tempo), sem banco, determinístico (PRNG `mulberry32`, hash para entregas).
* **Braços** (variável independente):

| Braço | Técnicas |
|---|---|
| A | controle: cada evento vira uma mensagem imediatamente (respeitando agendamentos do próprio cliente) |
| B | deduplicação + idempotência |
| C | B + supersession (com debounce limitado) |
| D | C + consolidação (template-resumo aprovado, mesma categoria) |
| E | D + otimizador de preço (agendamento em janelas abertas, cota, mensagem livre quando permitido) |
| F | E + operação direta na Cloud API (sem taxa de BSP) |

* **Variáveis dependentes**: mensagens enviadas/entregues, mensagens evitadas (por mecanismo), custo Meta
  (estimado na decisão e "realizado" na entrega simulada), custo BSP, custo de infraestrutura, custo
  total, mensagens gratuitas (FEP, janela, cota), distribuição por tier, preço desconhecido.
* **Controles**: política `meta-pmp-2026-10`, rate card `DEMO-BRL-2026-10`, fuso America/Sao_Paulo, 30 dias,
  2 números de telefone, taxa de entrega 97%, BSP hipotético de 10% sobre a Meta, infraestrutura
  R$ 0,00002/evento + R$ 0,00005/chamada ao provedor.

## 4. Dataset sintético

Gerador `packages/simulator/src/dataset.ts` (mesma seed → mesmos dados). Episódios: fluxo de pedido
(CREATED/PACKED/SHIPPED + pagamento + rastreio; parte em rajada de ~1 minuto, parte espalhada em horas),
OTP (com reenvio que é um código **novo**, não duplicata), campanhas semanais, lembrete de carrinho
(4 h depois, adiável 12 h), atendimento (cliente escreve, possivelmente via anúncio CTWA → respostas
livres → follow-ups em 76–160 h), alertas críticos (nunca atrasados), lembretes de consulta (com
reagendamento) e duplicação na origem.

| Parâmetro | Padrão | Cenários (§40) |
|---|---|---|
| mix | pedido 50%, OTP 12%, marketing 15%, carrinho 5%, atendimento 10%, crítico 3%, consulta 5% | — |
| mercados | BR 90%, US 5%, EU 3%, outros 2% | — |
| `duplicateRate` | 0,08 | LOW 0,02 · MEDIUM 0,08 · HIGH 0,20 |
| `burstRate` (agregação) | 0,35 | LOW 0,10 · MEDIUM 0,35 · HIGH 0,70 |
| `fepRate` | 0,25 (70% qualificam) | LOW 0,05 · MEDIUM 0,25 · HIGH 0,60 |

`pnpm generate` grava os datasets em CSV (1M em `.csv.gz`) com `manifest.json` (parâmetros e SHA-256).

## 5. Resultados

### 5.1 Simulação principal — 100.000 eventos (`reports/final-100k`)

| Braço | Mensagens | Evitadas | Custo Meta | BSP | Infra | Total | Economia Meta | Economia total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 96.320 | — | 8.952,92 | 895,29 | 4,82 | 9.853,02 | — | — |
| B | 91.701 | 4.619 | 8.257,39 | 825,74 | 6,51 | 9.089,64 | 7,77% | 7,75% |
| C | 82.635 | 13.685 | 7.895,12 | 789,51 | 6,06 | 8.690,69 | 11,82% | 11,80% |
| D | 73.655 | 22.665 | 7.534,09 | 753,41 | 5,61 | 8.293,10 | 15,85% | 15,83% |
| E | 73.655 | 22.665 | 7.386,51 | 738,65 | 5,61 | 8.130,76 | 17,50% | 17,48% |
| F | 73.655 | 22.665 | 7.386,51 | 0,00 | 5,61 | 7.392,11 | 17,50% | 24,98% |

(R$, tarifas DEMO.) Em E: 4.363 duplicatas bloqueadas, 9.328 supersessões, 8.974 intents consolidadas
em 4.487 mensagens; 1.754 mensagens gratuitas por FEP (A: 1.404); cota de Service 2.000/2.000 usada;
economia Meta estimada na decisão R$ 1.618,96 vs. "realizada" na entrega simulada R$ 1.566,41 (a
diferença vem das ~3% de falhas de entrega, que a Meta não cobra). Follow-ups agendados para até 160 h
depois entram em novembro; por isso parte das mensagens volta à faixa inicial de tier (reinício mensal).

### 5.2 Matriz científica — 9 cenários × {10k, 50k} × 3 seeds (`reports/research`)

Economia Meta média ± desvio-padrão (50.000 eventos):

| Cenário | B | C | D | E | F (total) |
|---|---:|---:|---:|---:|---:|
| LOW_DUPLICATION | 5,12 ± 0,18 | 9,27 ± 0,15 | 13,49 ± 0,14 | 15,10 ± 0,20 | 22,80 ± 0,18 |
| MEDIUM_DUPLICATION | 7,73 ± 0,24 | 11,73 ± 0,26 | 15,79 ± 0,30 | 17,29 ± 0,24 | 24,79 ± 0,22 |
| HIGH_DUPLICATION | 12,34 ± 0,08 | 16,02 ± 0,08 | 19,77 ± 0,19 | 21,14 ± 0,21 | 28,29 ± 0,19 |
| LOW_AGGREGATION | 7,73 ± 0,30 | 8,91 ± 0,36 | 10,00 ± 0,42 | 11,49 ± 0,32 | 19,51 ± 0,29 |
| HIGH_AGGREGATION | 7,63 ± 0,30 | 15,54 ± 0,32 | 23,62 ± 0,37 | 25,09 ± 0,33 | 31,89 ± 0,30 |
| LOW_FEP | 7,80 ± 0,25 | 11,73 ± 0,26 | 15,75 ± 0,27 | 16,05 ± 0,25 | 23,67 ± 0,22 |
| HIGH_FEP | 7,78 ± 0,16 | 11,86 ± 0,09 | 16,02 ± 0,02 | 19,73 ± 0,15 | 27,01 ± 0,14 |

(MEDIUM_AGGREGATION e MEDIUM_FEP coincidem com MEDIUM_DUPLICATION: são o mesmo preset padrão.)

### 5.3 Escala — 1.000.000 de eventos (`reports/research-1m`)

MEDIUM_DUPLICATION, 1 seed: economia Meta B 7,72% · C 11,36% · D 14,97% · E 16,54%; total F 24,10%;
222.186 mensagens evitadas; 451 s para os seis braços (≈ 75–96 µs/evento/braço, processo único).

### 5.4 Varreduras (braço E vs A, `reports/final-100k`)

| Parâmetro | Faixa | Economia Meta |
|---|---|---|
| volume (eventos) | 10k → 100k | 17,4% → 17,5% (estável: técnicas são proporcionais ao tráfego) |
| taxa de duplicação | 0 → 0,30 | 13,1% → 23,2% |
| atualizações em rajada | 0 → 1,0 | 8,2% → 31,5% |
| conversas via anúncio (FEP) | 0 → 0,75 | 14,9% → 18,5% |
| participação de atendimento (cota) | 0,05 → 0,40 | 15,7% – 16,7% (sem tendência) |

Gráficos SVG em `reports/*/charts/` (paleta validada para daltonismo; dados equivalentes em CSV).

## 6. Discussão

* **H1 confirmada** no domínio simulado: 54/54 execuções pareadas com economia Meta positiva em E
  (mínimo 11,1%, máximo 25,8%).
* **H2 confirmada**: nenhuma violação de monotonicidade B ≤ C ≤ D ≤ E nas 54 execuções.
* **H3**: forte para duplicação e rajadas (técnicas que evitam mensagens); moderada para FEP (o ganho
  vem de antecipar follow-ups para dentro de janelas já abertas). A cota de Service saturou em todos os
  cenários (2 números × 1.000/mês), por isso a varredura de "cota" não mostra efeito — o WCO não cria
  cota, apenas a consome na ordem correta.
* **H4 confirmada**: a maior parte da diferença E → F vem da taxa hipotética de BSP; a infraestrutura do
  WCO é um custo adicional pequeno (pode tornar a "economia de infraestrutura" negativa), por isso é
  reportada separadamente.
* Sob a política de out/2026, mensagens na janela de atendimento deixaram de ser gratuitas (Service com
  cota; Utility cobrada), o que explica "grátis por CSW = 0" nos resultados de 2026-10.

## 7. Limitações e ameaças à validade

* **Validade de construto**: custos com tarifas DEMO; a proporção entre categorias/mercados afeta o valor
  absoluto e, em menor grau, os percentuais. Reexecute com o rate card oficial (`--rate-card`).
* **Validade externa**: dataset sintético com parâmetros declarados; operações reais têm outra mistura de
  eventos, duplicação e comportamento de clientes. Use `POST /api/v1/import/history` com dados reais.
* **Comportamento da Meta**: entregas/falhas simuladas (97%); a cobrança real depende do objeto `pricing`
  dos webhooks; regras incertas estão em KNOWN-CONFLICTS.md (escopo da cota, reinício mensal, FEP 7 dias).
* **Validade interna**: mesmo motor nos braços e desenho pareado reduzem viés; a dispersão entre seeds é
  baixa (DP < 1,2 p.p.), mas seeds não substituem variabilidade de tráfego real.
* **Aceitação do negócio**: a economia por consolidação/supersession depende de tolerância a atrasos de
  30–120 s e de templates-resumo aprovados.

## 8. Reprodutibilidade

```bash
pnpm simulate                                                     # 5.1
pnpm research --sizes 10000,50000 --seeds 3                       # 5.2
pnpm research --sizes 1000000 --scenarios MEDIUM_DUPLICATION --seeds 1 --out reports/research-1m   # 5.3
pnpm generate --sizes 10000,50000,100000                          # datasets + manifest com SHA-256
pnpm simulate --dataset data/datasets/100000/HIGH_FEP.csv         # reexecutar a partir de arquivo
pnpm simulate --rate-card rate-card-oficial.json                  # com tarifas reais
```

Os relatórios registram data, commit, versão do Node, seeds, política e rate card usados.
