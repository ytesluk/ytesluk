# FinOps no envio

O módulo `packages/optimization/src/finops` é usado como está. A ligação com o envio fica em
`packages/services/src/finops-dispatch.ts` (antes de cada envio, no `dispatcher`) e em
`packages/services/src/webhooks.ts` (eventos da Meta).

## O que está ativo

| Módulo | Onde | Efeito |
|---|---|---|
| 5 — supressão global (131026 / 131049) | webhooks + envio | Um 131026 recebido por qualquer tenant segura o número para todos até expirar (1 d → 7 d → 30 d) ou até o cliente escrever. Um 131049 adia templates de marketing até expirar (24–72 h), se a mensagem puder esperar. |
| 2B — pool de templates-espelho | webhooks + envio | Se o template está registrado num grupo (`MirrorTemplateVariant`) e a Meta o reclassifica como MARKETING, o envio usa a próxima variante UTILITY aprovada do grupo. |
| Livro de economia | envio | Cada envio de template grava uma linha em `FinOpsSavingsLedger` (sem conteúdo da mensagem). |
| Cota mensal de service | envio | Contador do próprio módulo (`MonthlyServiceQuota`). |

## O que fica de fora, de propósito

* **Ponte HTTP externa (módulo 6)**: enviaria fora da Cloud API oficial; o produto promete só a API oficial.
  O transporte é sempre `DIRECT_CLOUD_API`.
* **Mensagem livre na janela e janela FEP (módulos 1 e 3)**: o motor de preços já faz isso no planejamento.
  O FinOps recebe o custo real deste envio, então não registra economia que não aconteceu.
* **Taxa de BSP evitada (módulo 4)**: o WCO já chama a Cloud API direto; sem BSP anterior configurado, é 0.
* **Split em duas etapas (módulo 2A)**: precisa de um texto de oferta separado, que a API de intents não recebe.
* **Mensagens críticas e de autenticação** não passam pelo FinOps: um código de verificação nunca é segurado.
* **Marketing urgente** (`mustSendImmediately`) ou cujo prazo vence antes do fim do 131049 é tentada mesmo
  assim, como o planejador já decide.

Se o FinOps falhar, o envio segue sem ele (registrado em log).

## Configuração

* `FINOPS_ENABLED=false` desliga.
* `FINOPS_GLOBAL_SALT`: chave do hash de telefone compartilhado entre tenants. Em produção, defina uma
  (`openssl rand -hex 32`); sem ela o módulo usa um valor fixo.

## Atenção

* A supressão global compartilha entre tenants o fato de um número estar inválido (hash, sem o telefone).
  Avalie isso na política de privacidade (LGPD).
* Os valores do livro estão na moeda da tabela de preços (as colunas dizem USD; com tabela em BRL, são BRL).
