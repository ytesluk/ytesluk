# Segurança

## Autenticação

| Quem | Como | Armazenamento |
|---|---|---|
| Usuários do dashboard | e-mail + senha → JWT HS256 (`jose`, TTL `JWT_TTL_SECONDS`, padrão 8 h) | senha com **scrypt** (sal aleatório); login com verificação de hash mesmo para usuário inexistente; tentativas falhas auditadas e limitadas (20/min) |
| Sistemas de origem | `X-API-Key` | só o **SHA-256** da chave; prefixo para identificação; revogável; exibida uma única vez |
| Dashboard → API | BFF Next.js: JWT em cookie `httpOnly`, `SameSite=Lax`, `Secure` em HTTPS; o JavaScript do navegador nunca vê o token | — |

O papel e o tenant são relidos do banco a cada requisição (usuário/chave desativados perdem acesso imediatamente).

## Autorização (RBAC)

| Permissão | OWNER | ADMIN | ANALYST | OPERATOR |
|---|:-:|:-:|:-:|:-:|
| enviar intents | ✔ | | | ✔ |
| ler mensagens/conversas | ✔ | ✔ | ✔ | ✔ |
| analytics, custos, simulador | ✔ | ✔ | ✔ | |
| preços (ler) / políticas (ler) / templates (ler) | ✔ | ✔ | ✔ | templates |
| preços, políticas, templates (escrever) | ✔ | ✔ | | |
| conectar WhatsApp, webhooks, auditoria, privacidade | ✔ | ✔ | | webhooks |
| tenant, usuários, API keys | ✔ | | | |
| observabilidade | ✔ | ✔ | | ✔ |

A interface esconde o que o papel não pode usar, mas a API **sempre** reverifica (testes E2E cobrem 401/403).

## Segredos

* `SecretProvider` com três modos: `development` (variáveis de ambiente + valores determinísticos só em
  `APP_MODE=development`), `docker` (arquivos em `/run/secrets/<nome>`), `production` (ambiente, sem
  fallback; ponto de extensão `registerSecretBackend` para Vault/KMS/Secrets Manager).
* `APP_MODE=production` recusa iniciar sem `ENCRYPTION_KEY` (32 bytes), `JWT_SECRET` (≥ 32), `HASH_PEPPER`
  (≥ 16), sem `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN`/`META_GRAPH_API_VERSION` (com Meta real) e
  recusa `MOCK_WHATSAPP=true` (salvo `ALLOW_MOCK_IN_PRODUCTION` para staging).
* Tokens de acesso da Meta por WABA ficam **criptografados** (AES-256-GCM, IV aleatório, tag de
  autenticação) em `Waba.accessTokenEncrypted`; nunca em texto puro.
* Onboarding comercial (Embedded Signup) bloqueado em produção sem credenciais de parceiro
  (`commercialOnboardingStatus`); um token de desenvolvedor não administra WABAs de terceiros.

## Dados pessoais

* Telefone: `phoneEncrypted` (AES-256-GCM), `phoneHash` (HMAC-SHA-256 com pepper, chave de busca),
  `phoneMasked` (`+55*******6666`) para exibição.
* Conteúdo de mensagem livre não é devolvido pela API de auditoria (`"[stored]"`) e é removido pela retenção.

## Logs

* Pino com redação por caminho (`authorization`, `cookie`, `x-hub-signature-256`, `password`, tokens…) e
  redação profunda (`redact()`): chaves secretas → `[REDACTED]`; campos de telefone → máscara
  (só quando o valor parece telefone); campos de conteúdo → `[CONTENT]`; números E.164 em texto livre → máscara.
* Nunca são logados: `META_ACCESS_TOKEN`, cabeçalho `Authorization`, segredos de webhook, senhas, telefone
  completo, conteúdo de mensagens.

## Webhooks

HMAC-SHA256 do corpo bruto com comparação em tempo constante; inválido → 401 sem persistir. Ver [WEBHOOKS.md](WEBHOOKS.md).

## HTTP

* `@fastify/helmet`, CORS restrito a `CORS_ORIGINS`/`NEXT_PUBLIC_APP_URL`, limite de corpo (2 MB; 12 MB
  importação de preços; 60 MB histórico CSV).
* Rate limit global por credencial (hash) ou IP, armazenado no Redis (`RATE_LIMIT_PER_MINUTE`, padrão 600).
* Dashboard: CSP (`default-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`; mutações no BFF exigem `Origin` do próprio host.
* Erros padronizados (`code`, `message`, `requestId`) sem stack trace.

## Isolamento entre tenants

* Tenant derivado só da credencial; todos os serviços filtram por `tenantId`; SQL bruto sempre com
  `tenantId` parametrizado.
* `forTenant()` (extensão Prisma) como defesa adicional: injeta `tenantId` e recusa escrita em outro tenant.
* Testes: integração (auditoria, listas, analytics e guard) e E2E HTTP (404 para intent de outro tenant).

## Dependências e cadeia de suprimentos

`pnpm-lock.yaml` congelado no build (`--frozen-lockfile`); scripts de instalação restritos
(`onlyBuiltDependencies`); imagens Docker rodam como usuário `node`.

## Riscos conhecidos

Ver [LIMITATIONS.md](LIMITATIONS.md): sem MFA/SSO, rotação de chave de criptografia manual, JWT sem lista de
revogação (expira pelo TTL; desativar o usuário bloqueia na próxima requisição).
