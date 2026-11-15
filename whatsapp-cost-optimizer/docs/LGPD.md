# LGPD (Lei 13.709/2018)

> Documento técnico de apoio. A definição de bases legais, contratos (operador/controlador) e
> comunicação com titulares cabe ao encarregado (DPO) e ao jurídico da empresa usuária.

## Papéis

A empresa usuária (tenant) é **controladora** dos dados dos seus clientes; o WCO atua como **operador**,
processando dados para enviar mensagens em nome do tenant. A Meta é destinatária para a entrega das mensagens.

## Inventário e minimização

| Dado | Finalidade | Como é guardado |
|---|---|---|
| Telefone do cliente | entrega da mensagem, janelas, consentimento | cifrado (AES-256-GCM) + hash HMAC (busca) + máscara (exibição) |
| Payload do evento / texto livre | montar a mensagem | removido após `payloadRetentionDays` (padrão 30) |
| Webhooks brutos | auditoria/reprocessamento | removidos após `rawWebhookRetentionDays` (padrão 30) |
| Decisões, custos, economia, status | faturamento, auditoria, analytics | sem telefone; vinculados a ids pseudônimos |
| Consentimento | base para envio | `ConsentRecord` com data, origem e escopo (ALL/MARKETING) |
| Follow-up adiado (texto da oferta) | enviar a oferta se o cliente responder | cifrado; apagado ao expirar, na retenção de payloads e na exclusão do titular; incluído na exportação |
| Entregabilidade (erros 131026/131049 da Meta) | não insistir em números que a Meta recusou | **por tenant**, só o hash do telefone, com validade; nunca compartilhado entre tenants; incluído na exportação e apagado na exclusão |
| Webhooks de saída (espelho/eventos) | integrar com o CRM/canais do próprio tenant | segredo e cabeçalho de autorização cifrados; o conteúdo vai só para os endpoints do tenant, por HTTPS em produção; a fila guarda ids, não conteúdo |
| Usuários do dashboard | acesso | e-mail, nome, hash de senha |

Logs nunca contêm telefone completo nem conteúdo de mensagem.

## Retenção

Configurável por tenant (Admin › Privacidade ou `PUT /api/v1/privacy/retention`): dados de mensagens
30/90/180/365 dias (padrão 90), payloads, webhooks brutos e auditoria (mín. 90 dias). O job diário
`retention` remove conteúdo/payloads vencidos e registra a execução.

## Direitos do titular

| Direito | Como |
|---|---|
| Acesso / portabilidade | `POST /api/v1/privacy/export` → JSON com cliente, consentimentos, intents e status (Admin › Privacidade) |
| Eliminação | `POST /api/v1/privacy/delete` → remove telefone cifrado, conteúdo e payloads; marca `erasedAt`; agregados permanecem anonimizados; novas mensagens exigem novo opt-in |
| Revogação de consentimento | `POST /api/v1/privacy/consent` (OPT_OUT, ALL ou MARKETING), palavras de opt-out recebidas no WhatsApp ("PARAR", "SAIR", "STOP"…) e webhook `user_preferences` |

Cada solicitação gera `DataSubjectRequest`/auditoria. A eliminação é por tenant (o mesmo telefone em outro tenant é
outra relação de tratamento).

## Consentimento e opt-out

* `requireOptIn` por tenant bloqueia templates sem opt-in registrado (regra `noOptIn → BLOCK`).
* Opt-out total bloqueia qualquer envio; opt-out de marketing bloqueia apenas Marketing.
* O bloqueio é reavaliado no momento do envio (uma mensagem no buffer não sai se o cliente pediu para sair).

## Roteamento de custo e consentimento

* Conteúdo promocional enviado como mensagem de atendimento (template → mensagem livre, follow-up
  adiado) continua seguindo o consentimento de marketing: o WCO guarda a categoria do conteúdo e
  reavalia opt-in/opt-out no envio.
* O evento `INBOUND_WAKEUP_REQUESTED` leva o telefone do cliente ao endpoint do próprio tenant (que é
  o controlador e já tem esse dado), para que ele faça o convite pelos seus canais. O consentimento
  para e-mail, push ou SMS é responsabilidade do tenant.
* O espelho de webhooks entrega ao tenant apenas os dados das suas próprias WABAs.

## Segurança

Ver [SECURITY.md](SECURITY.md): criptografia em repouso, controle de acesso por papel, auditoria de
alterações (criação, envio, cancelamento, otimização, preço, política, importação, integração, erro).

## Transferência internacional

A entrega via WhatsApp envolve a infraestrutura da Meta. O tenant deve avaliar cláusulas e bases para
transferência internacional conforme a ANPD.
