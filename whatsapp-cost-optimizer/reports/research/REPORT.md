# Matriz do experimento acadêmico (braços A–F)

> **Resultados SIMULADOS** com o rate card **DEMO** (valores fictícios, não são tarifas da Meta). Não representam economia garantida.

- Gerado em 2026-10-02T15:46:16.627Z · commit `1097d4e` · Node v22.22.0 · duração 500 s
- Tamanhos: 10.000, 50.000 eventos · cenários: 9 · seeds: 20261002, 20268921, 20276840
- Desenho pareado: para cada (cenário, tamanho, seed) o MESMO dataset é reprocessado por todos os braços.
- Reproduzir: `pnpm research --sizes 10000,50000 --seeds 3`

## Economia Meta média por braço (vs controle A)

| Cenário | Tamanho | B | C | D | E | F (total) | Mensagens evitadas (E) |
|---|---:|---:|---:|---:|---:|---:|---:|
| LOW_DUPLICATION | 10.000 | 5.49% ± 0.09 | 9.81% ± 0.15 | 14.05% ± 0.21 | 15.33% ± 0.25 | 23.01% ± 0.23 | 2.054 |
| MEDIUM_DUPLICATION | 10.000 | 7.91% ± 0.46 | 11.85% ± 0.49 | 15.81% ± 0.5 | 17.27% ± 0.25 | 24.76% ± 0.23 | 2.177,67 |
| HIGH_DUPLICATION | 10.000 | 12.64% ± 0.23 | 16.42% ± 0.19 | 20.27% ± 0.31 | 21.61% ± 0.53 | 28.71% ± 0.48 | 2.436,33 |
| LOW_AGGREGATION | 10.000 | 7.89% ± 0.41 | 9.22% ± 0.5 | 10.48% ± 0.56 | 11.86% ± 0.4 | 19.84% ± 0.36 | 1.013,33 |
| MEDIUM_AGGREGATION | 10.000 | 7.91% ± 0.46 | 11.85% ± 0.49 | 15.81% ± 0.5 | 17.27% ± 0.25 | 24.76% ± 0.23 | 2.177,67 |
| HIGH_AGGREGATION | 10.000 | 7.66% ± 0.37 | 15.72% ± 0.22 | 23.84% ± 0.35 | 25.39% ± 0.42 | 32.16% ± 0.38 | 3.877,33 |
| LOW_FEP | 10.000 | 8.05% ± 0.57 | 12.09% ± 0.47 | 16.12% ± 0.46 | 16.4% ± 0.39 | 23.99% ± 0.35 | 2.211 |
| MEDIUM_FEP | 10.000 | 7.91% ± 0.46 | 11.85% ± 0.49 | 15.81% ± 0.5 | 17.27% ± 0.25 | 24.76% ± 0.23 | 2.177,67 |
| HIGH_FEP | 10.000 | 7.91% ± 0.4 | 11.88% ± 0.42 | 15.79% ± 0.47 | 19.18% ± 0.03 | 26.51% ± 0.03 | 2.168,67 |
| LOW_DUPLICATION | 50.000 | 5.12% ± 0.18 | 9.27% ± 0.15 | 13.49% ± 0.14 | 15.1% ± 0.2 | 22.8% ± 0.18 | 10.366,67 |
| MEDIUM_DUPLICATION | 50.000 | 7.73% ± 0.24 | 11.73% ± 0.26 | 15.79% ± 0.3 | 17.29% ± 0.24 | 24.79% ± 0.22 | 11.125,33 |
| HIGH_DUPLICATION | 50.000 | 12.34% ± 0.08 | 16.02% ± 0.08 | 19.77% ± 0.19 | 21.14% ± 0.21 | 28.29% ± 0.19 | 12.216 |
| LOW_AGGREGATION | 50.000 | 7.73% ± 0.3 | 8.91% ± 0.36 | 10% ± 0.42 | 11.49% ± 0.32 | 19.51% ± 0.29 | 4.894,67 |
| MEDIUM_AGGREGATION | 50.000 | 7.73% ± 0.24 | 11.73% ± 0.26 | 15.79% ± 0.3 | 17.29% ± 0.24 | 24.79% ± 0.22 | 11.125,33 |
| HIGH_AGGREGATION | 50.000 | 7.63% ± 0.3 | 15.54% ± 0.32 | 23.62% ± 0.37 | 25.09% ± 0.33 | 31.89% ± 0.3 | 19.567,67 |
| LOW_FEP | 50.000 | 7.8% ± 0.25 | 11.73% ± 0.26 | 15.75% ± 0.27 | 16.05% ± 0.25 | 23.67% ± 0.22 | 11.061 |
| MEDIUM_FEP | 50.000 | 7.73% ± 0.24 | 11.73% ± 0.26 | 15.79% ± 0.3 | 17.29% ± 0.24 | 24.79% ± 0.22 | 11.125,33 |
| HIGH_FEP | 50.000 | 7.78% ± 0.16 | 11.86% ± 0.09 | 16.02% ± 0.02 | 19.73% ± 0.15 | 27.01% ± 0.14 | 11.260,33 |

Valores: média ± desvio-padrão amostral entre seeds. B–E: economia no custo Meta. F: economia total (Meta + BSP + infraestrutura), pois F remove a taxa de BSP hipotética.

## Teste da hipótese H1

H1: *o braço com todas as técnicas de otimização (E) tem custo Meta menor que o controle (A) no mesmo dataset.* Em 54 de 54 execuções pareadas a economia Meta de E foi positiva (mínimo 11.14%, máximo 25.84%).

Monotonicidade esperada: B ≤ C ≤ D ≤ E em economia Meta (cada braço adiciona técnicas ao anterior).
Nenhuma violação de monotonicidade observada.

## Desempenho

Tempo médio de simulação do braço E: 64 µs/evento (processo único, motor em memória — não é o throughput do sistema com PostgreSQL/Redis).

## Arquivos

- `matrix.csv` — uma linha por (cenário, tamanho, seed, braço)
- `summary.csv` — média, desvio, mínimo e máximo por (cenário, tamanho, braço)
- `charts/*.svg` — gráficos (mesmos dados das tabelas acima)
