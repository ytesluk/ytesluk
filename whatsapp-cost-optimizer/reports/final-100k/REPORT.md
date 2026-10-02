# Simulação final obrigatória (100.000 eventos) — final-100k

> **Resultado SIMULADO.** Custos calculados com o rate card **DEMO** (valores fictícios, não são tarifas da Meta). Nunca é economia garantida.

- Gerado em: 2026-10-02T14:29:48.139Z
- Dataset: 100.001 eventos de negócio + 8.055 mensagens de clientes · seed 20261002 · 30 dias a partir de 2026-10-01T03:00:00.000Z (America/Sao_Paulo)
- Políticas de preço usadas: meta-pmp-2026-10 (93.310 entregas)
- Rate cards usados: DEMO-BRL-2026-10
- Modelo de custo BSP (hipótese): Hypothetical BSP: 10% over Meta charges · infra: 0.00002/evento WCO, 0.00005/chamada ao provedor

## Resultados por braço

| Braço | Descrição | Eventos | Mensagens | Entregues | Evitadas | Dedup | Supersession | Consolidadas | Custo Meta | Custo BSP | Custo infra | Custo total | Custo médio/entregue |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | Sem otimização (controle) | 96.320 | 96.320 | 93.310 | 0 | 0 | 0 | 0 | R$ 8.952,92 | R$ 895,29 | R$ 4,82 | R$ 9.853,02 | 0.0959 |
| B | Deduplicação | 96.320 | 91.701 | 88.800 | 4.619 | 4.619 | 0 | 0 | R$ 8.257,39 | R$ 825,74 | R$ 6,51 | R$ 9.089,64 | 0.0930 |
| C | Dedup + supersession | 96.320 | 82.635 | 80.011 | 13.685 | 4.357 | 9.328 | 0 | R$ 7.895,12 | R$ 789,51 | R$ 6,06 | R$ 8.690,69 | 0.0987 |
| D | Dedup + supersession + agregação | 96.320 | 73.655 | 71.304 | 22.665 | 4.363 | 9.328 | 8.974 | R$ 7.534,09 | R$ 753,41 | R$ 5,61 | R$ 8.293,10 | 0.1057 |
| E | D + otimizador de preço | 96.320 | 73.655 | 71.304 | 22.665 | 4.363 | 9.328 | 8.974 | R$ 7.386,51 | R$ 738,65 | R$ 5,61 | R$ 8.130,76 | 0.1036 |
| F | Todas as técnicas (E + Cloud API direta) | 96.320 | 73.655 | 71.304 | 22.665 | 4.363 | 9.328 | 8.974 | R$ 7.386,51 | R$ 0,00 | R$ 5,61 | R$ 7.392,11 | 0.1036 |

## Economia em relação ao controle (A)

| Braço | Economia Meta | Economia Meta % | Economia BSP | Economia infra | Economia total | Economia total % | Estimada (decisão) | Realizada (entrega simulada) | Mensagens evitadas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| B | R$ 695,52 | 7.77% | R$ 69,55 | -R$ 1,70 | R$ 763,38 | 7.75% | R$ 717,59 | R$ 695,52 | 4.619 |
| C | R$ 1.057,79 | 11.82% | R$ 105,78 | -R$ 1,24 | R$ 1.162,33 | 11.80% | R$ 1.092,24 | R$ 1.057,79 | 13.685 |
| D | R$ 1.418,83 | 15.85% | R$ 141,88 | -R$ 0,79 | R$ 1.559,92 | 15.83% | R$ 1.464,05 | R$ 1.418,83 | 22.665 |
| E | R$ 1.566,41 | 17.50% | R$ 156,64 | -R$ 0,79 | R$ 1.722,26 | 17.48% | R$ 1.618,96 | R$ 1.566,41 | 22.665 |
| F | R$ 1.566,41 | 17.50% | R$ 895,29 | -R$ 0,79 | R$ 2.460,91 | 24.98% | R$ 1.618,96 | R$ 1.566,41 | 22.665 |

Economia Meta, BSP e infraestrutura são apresentadas separadamente. A economia de infraestrutura pode ser **negativa**: o WCO tem custo próprio de processamento por evento.

## Janelas gratuitas, cota e tiers

| Braço | Grátis por FEP | Grátis por CSW | Cota Service usada | Utilização da cota | Mensagens pagas | Preço desconhecido |
|---|---:|---:|---:|---:|---:|---:|
| A | 1.404 | 0 | 2.000 / 2.000 | 100% | 89.906 | 0 |
| B | 1.342 | 0 | 2.000 / 2.000 | 100% | 85.458 | 0 |
| C | 1.324 | 0 | 2.000 / 2.000 | 100% | 76.687 | 0 |
| D | 1.306 | 0 | 2.000 / 2.000 | 100% | 67.998 | 0 |
| E | 1.754 | 0 | 2.000 / 2.000 | 100% | 67.550 | 0 |
| F | 1.754 | 0 | 2.000 / 2.000 | 100% | 67.550 | 0 |

### Distribuição por tier (mensagens cobradas)

| Braço | Mercado | Categoria | Tier | Mensagens |
|---|---|---|---|---:|
| A | BR | UTILITY | Tier 2 (25,001-100,000) | 32.531 |
| A | BR | UTILITY | Tier 1 (10,001-25,000) | 15.000 |
| A | BR | UTILITY | List rate (1-10,000) | 10.088 |
| A | NORTH_AMERICA | UTILITY | List rate (1-10,000) | 3.120 |
| A | BR | AUTHENTICATION | List rate (1-10,000) | 2.976 |
| A | FR | UTILITY | List rate (1-10,000) | 2.012 |
| A | NG | UTILITY | List rate (1-10,000) | 1.273 |
| A | NORTH_AMERICA | AUTHENTICATION | List rate (1-10,000) | 177 |
| A | FR | AUTHENTICATION | List rate (1-10,000) | 107 |
| A | NG | AUTHENTICATION | List rate (1-10,000) | 78 |
| E | BR | UTILITY | Tier 1 (10,001-25,000) | 15.000 |
| E | BR | UTILITY | Tier 2 (25,001-100,000) | 14.683 |
| E | BR | UTILITY | List rate (1-10,000) | 10.072 |
| E | BR | AUTHENTICATION | List rate (1-10,000) | 2.931 |
| E | NORTH_AMERICA | UTILITY | List rate (1-10,000) | 2.176 |
| E | FR | UTILITY | List rate (1-10,000) | 1.362 |
| E | NG | UTILITY | List rate (1-10,000) | 868 |
| E | NORTH_AMERICA | AUTHENTICATION | List rate (1-10,000) | 172 |
| E | FR | AUTHENTICATION | List rate (1-10,000) | 106 |
| E | NG | AUTHENTICATION | List rate (1-10,000) | 77 |

## Varreduras de parâmetros (braço E vs A)

### cost_vs_volume (events)

| events | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |
|---:|---:|---:|---:|---:|---:|---:|
| 10000 | 9.623 | 7.417 | R$ 877,61 | R$ 725,00 | 17.39% | 17.37% |
| 25000 | 24.038 | 18.450 | R$ 2.181,53 | R$ 1.805,26 | 17.25% | 17.23% |
| 50000 | 48.106 | 36.944 | R$ 4.455,61 | R$ 3.676,41 | 17.49% | 17.47% |
| 100000 | 96.320 | 73.655 | R$ 8.952,92 | R$ 7.386,51 | 17.5% | 17.48% |

### savings_vs_duplication (duplicateRate)

| duplicateRate | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 20.004 | 16.087 | R$ 1.837,32 | R$ 1.597,38 | 13.06% | 13.04% |
| 0.05 | 19.519 | 15.230 | R$ 1.741,30 | R$ 1.471,05 | 15.52% | 15.5% |
| 0.1 | 19.035 | 14.730 | R$ 1.715,70 | R$ 1.438,49 | 16.16% | 16.14% |
| 0.2 | 18.319 | 13.488 | R$ 1.663,30 | R$ 1.320,43 | 20.61% | 20.6% |
| 0.3 | 17.672 | 12.621 | R$ 1.608,04 | R$ 1.234,26 | 23.24% | 23.23% |

### savings_vs_aggregation (burstRate)

| burstRate | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 19.262 | 18.319 | R$ 1.744,70 | R$ 1.601,95 | 8.18% | 8.16% |
| 0.25 | 19.208 | 15.747 | R$ 1.729,96 | R$ 1.494,44 | 13.61% | 13.6% |
| 0.5 | 19.238 | 13.531 | R$ 1.730,85 | R$ 1.390,47 | 19.67% | 19.65% |
| 0.75 | 19.272 | 11.082 | R$ 1.737,33 | R$ 1.289,14 | 25.8% | 25.79% |
| 1 | 19.235 | 8.629 | R$ 1.751,14 | R$ 1.199,04 | 31.53% | 31.52% |

### savings_vs_fep (fepRate)

| fepRate | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 19.229 | 14.861 | R$ 1.748,38 | R$ 1.488,63 | 14.86% | 14.84% |
| 0.1 | 19.230 | 14.867 | R$ 1.740,07 | R$ 1.472,25 | 15.39% | 15.37% |
| 0.25 | 19.225 | 14.887 | R$ 1.733,79 | R$ 1.462,03 | 15.67% | 15.66% |
| 0.5 | 19.254 | 14.859 | R$ 1.733,58 | R$ 1.437,99 | 17.05% | 17.03% |
| 0.75 | 19.251 | 14.875 | R$ 1.726,45 | R$ 1.406,94 | 18.51% | 18.49% |

### savings_vs_free_quota (supportShare)

| supportShare | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |
|---:|---:|---:|---:|---:|---:|---:|
| 0.05 | 19.261 | 14.620 | R$ 1.724,38 | R$ 1.439,73 | 16.51% | 16.49% |
| 0.1 | 19.225 | 14.887 | R$ 1.733,79 | R$ 1.462,03 | 15.67% | 15.66% |
| 0.2 | 19.237 | 15.269 | R$ 1.840,03 | R$ 1.532,81 | 16.7% | 16.68% |
| 0.3 | 19.225 | 15.601 | R$ 1.910,23 | R$ 1.603,02 | 16.08% | 16.07% |
| 0.4 | 19.239 | 15.720 | R$ 2.003,15 | R$ 1.681,22 | 16.07% | 16.05% |

## Gráficos

Arquivos SVG em `charts/` e os mesmos dados em CSV (visão de tabela).

## Notas
- Cada braço reprocessa exatamente o mesmo dataset com os mesmos motores de produção (OptimizationEngine, PricingPolicy, TierCalculator); só os recursos habilitados mudam.
- 'Estimada' = custo previsto no momento da decisão; 'Realizada' = custo da entrega simulada (no sistema real, confirmada pelo objeto pricing dos webhooks da Meta).
- Mensagens com preço desconhecido (UNKNOWN) não são contadas como economia.
- Tempo de execução: 86.2 s.
