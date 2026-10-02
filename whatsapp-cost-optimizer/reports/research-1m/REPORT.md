# Matriz do experimento acadêmico (braços A–F)

> **Resultados SIMULADOS** com o rate card **DEMO** (valores fictícios, não são tarifas da Meta). Não representam economia garantida.

- Gerado em 2026-10-02T15:54:19.593Z · commit `e8d341c` · Node v22.22.0 · duração 482 s
- Tamanhos: 1.000.000 eventos · cenários: 1 · seeds: 20261002
- Desenho pareado: para cada (cenário, tamanho, seed) o MESMO dataset é reprocessado por todos os braços.
- Reproduzir: `pnpm research --sizes 1000000 --seeds 1`

## Economia Meta média por braço (vs controle A)

| Cenário | Tamanho | B | C | D | E | F (total) | Mensagens evitadas (E) |
|---|---:|---:|---:|---:|---:|---:|---:|
| MEDIUM_DUPLICATION | 1.000.000 | 7.72% ± 0 | 11.36% ± 0 | 14.97% ± 0 | 16.54% ± 0 | 24.1% ± 0 | 222.186 |

Valores: média ± desvio-padrão amostral entre seeds. B–E: economia no custo Meta. F: economia total (Meta + BSP + infraestrutura), pois F remove a taxa de BSP hipotética.

## Teste da hipótese H1

H1: *o braço com todas as técnicas de otimização (E) tem custo Meta menor que o controle (A) no mesmo dataset.* Em 1 de 1 execuções pareadas a economia Meta de E foi positiva (mínimo 16.54%, máximo 16.54%).

Monotonicidade esperada: B ≤ C ≤ D ≤ E em economia Meta (cada braço adiciona técnicas ao anterior).
Nenhuma violação de monotonicidade observada.

## Desempenho

Tempo médio de simulação do braço E: 98 µs/evento (processo único, motor em memória — não é o throughput do sistema com PostgreSQL/Redis).

## Arquivos

- `matrix.csv` — uma linha por (cenário, tamanho, seed, braço)
- `summary.csv` — média, desvio, mínimo e máximo por (cenário, tamanho, braço)
- `charts/*.svg` — gráficos (mesmos dados das tabelas acima)
