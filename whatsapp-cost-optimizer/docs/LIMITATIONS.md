# Limitações conhecidas (produção)

## Dependências da Meta

* **Sem credenciais reais neste ambiente**: o fluxo com a Cloud API real (envio, Embedded Signup, troca de
  código, registro de número) está implementado e testado contra respostas simuladas, mas não foi
  exercitado contra a Meta. Valide em um número de teste antes de produção (SETUP-META.md).
* **Tarifas**: só há rate cards DEMO. A Meta não oferece API de preços; os arquivos oficiais precisam ser
  importados manualmente e o formato exato dos CSVs oficiais não pôde ser verificado (KNOWN-CONFLICTS C6),
  por isso o importador é tolerante e falha ruidosamente.
* **Regras incertas** (KNOWN-CONFLICTS): escopo da cota de Service (número vs. WABA), fuso do reinício
  mensal da cota, janela CTWA de 7 dias (política UNVERIFIED, nunca usada automaticamente), comportamento
  com método de pagamento ausente. A Meta é a autoridade final: custos realizados seguem o objeto `pricing`.
* **Tiers**: o WCO estima a posição no mês a partir do que ele próprio enviou; mensagens enviadas por
  outros sistemas no mesmo portfólio não são vistas (o tier real pode ser mais alto).
* **Meta Business Agent**: cobrado por token; não modelado (avaliações retornam UNKNOWN) e não enviado pelo WCO.
* **Embedded Signup**: o fluxo completo (SDK da Meta no navegador + troca do código, webhooks e registro
  no servidor) está implementado e foi testado com o SDK e a Graph API simulados; precisa ser validado
  com um app Tech Provider real, em domínio HTTPS aprovado.

## Produto

* Template-resumo para consolidação precisa ser criado e aprovado pelo tenant; sem ele, não há consolidação.
* Atrasos de 30–120 s (debounce) são o preço da supersession/consolidação; cada tenant deve calibrar.
* Mensagens de mídia, interativas e listas: o provedor suporta envio, mas o otimizador trata principalmente
  templates e texto.
* Faturamento do próprio SaaS: uso mensal medido, alertas de volume do plano e faturas em rascunho
  (DRAFT) geradas no fechamento do mês; **sem gateway de pagamento** (cobrança, boleto/Pix/cartão, nota
  fiscal) e sem troca de plano pelo próprio cliente — o operador muda o plano em
  `POST /api/v1/admin/platform/tenants/{id}/plan`.
* Cadastro self-service não verifica o e-mail nem tem recuperação de senha.
* Assistente de classificação de templates (IA) é um ponto de extensão desligado: não há integração com
  provedor de LLM embarcada.

## Caixa de entrada

* Envia texto (dentro da janela de 24 h) e templates aprovados; ainda não envia mídia, botões ou listas, e
  mensagens recebidas de mídia aparecem como `[image]`, `[audio]`… (com a legenda, se houver).
* Atualização por consulta a cada 3–4 s (sem WebSocket); sem atribuição/transferência entre atendentes,
  respostas rápidas ou boas-vindas automáticas (próximos passos).
* Só mostra conversas a partir da ativação: o WCO não guardava textos antes (minimização).
* Só funciona com número da API oficial (Cloud API). Números no app WhatsApp Business exigem o modo de
  coexistência via Embedded Signup (Tech Provider).

## Segurança e operação

* Sem MFA/SSO; JWT sem lista de revogação (expira pelo TTL; usuário desativado perde acesso na próxima requisição).
* Rotação de `ENCRYPTION_KEY` não automatizada (dados cifrados precisam ser recifrados).
* `forTenant()` (guard de tenant no ORM) existe e é testado, mas os serviços dependem principalmente de
  filtros explícitos por `tenantId`; adotar o guard em todos os repositórios é um reforço recomendado.
* Retenção remove conteúdo/payloads; backups do banco precisam seguir a mesma política (fora do escopo do app).
* Sem particionamento de tabelas por tempo; volumes muito altos pedirão particionar `MessageIntent`,
  `ConversationEvent` e `WebhookEvent`.

## Simulação

* Resultados simulados com tarifas DEMO e dataset sintético; ver ameaças à validade em ACADEMIC-EXPERIMENT.md.
* O simulador em memória não modela latência de banco/filas nem limites por par de usuário.

## Próximos passos sugeridos

1. Conectar um número de teste da Meta e validar envio/webhooks/pricing reais.
2. Importar o rate card oficial (BRL) e reexecutar `pnpm simulate --rate-card`.
3. Aplicar `forTenant()` em todos os repositórios e adicionar MFA para OWNER/ADMIN.
4. Importar histórico real (CSV, com `entityId`) para medir a economia e calibrar debounce/atraso — ver TESTAR-ECONOMIA.md.
5. SaaS: tornar-se Tech Provider na Meta e validar o Embedded Signup real; integrar um gateway de
   pagamento às faturas DRAFT; verificação de e-mail e recuperação de senha; termos de uso e política
   de privacidade publicados (`TERMS_URL`, `PRIVACY_URL`).
