# Implantação

## Docker Compose (stack completo)

```bash
docker compose up -d --build
docker compose ps                 # postgres, redis, migrate (exited 0), api, worker, web — healthy
API_URL=http://localhost:4000 pnpm smoke
```

| Serviço | Imagem/target | Porta | Observações |
|---|---|---|---|
| postgres | `postgres:16-alpine` | 127.0.0.1:5432 | volume `pgdata` |
| redis | `redis:7-alpine` | 127.0.0.1:6379 | AOF, `noeviction` (filas) |
| migrate | `tools` | — | `prisma migrate deploy` + seed idempotente se `SEED=true` |
| api | `api` | 4000 | `/api/v1/health`, `/api/docs`, `/api/v1/metrics` |
| worker | `worker` | 9100 (interna) | `/health`, `/metrics`; escalável (`docker compose up --scale worker=3`) |
| web | `web` (Next standalone) | 3000 | BFF; fala com a API por `API_INTERNAL_URL` |

Portas no host são configuráveis (`API_HOST_PORT`, `WEB_HOST_PORT`, `PG_HOST_PORT`, `REDIS_HOST_PORT`).

### Build atrás de proxy corporativo

```bash
docker build --network host --secret id=ca,src=/caminho/ca-do-proxy.pem \
  --build-arg HTTPS_PROXY=$HTTPS_PROXY -f infra/docker/Dockerfile --target api -t wco-api:local .
```

O Dockerfile usa o segredo `ca` (se existir) como `NODE_EXTRA_CA_CERTS` apenas durante a instalação.

## Produção

1. `APP_MODE=production`, `MOCK_WHATSAPP=false`, `META_GRAPH_API_VERSION`, URLs públicas
   (`API_PUBLIC_URL`, `NEXT_PUBLIC_APP_URL` em HTTPS — o cookie de sessão vira `Secure`).
2. Segredos fora do ambiente:
   ```bash
   infra/docker/gen-secrets.sh            # gera encryption_key, jwt_secret, hash_pepper; cria arquivos Meta vazios
   # preencha infra/docker/secrets/meta_app_secret, meta_webhook_verify_token (e meta_access_token, se usar)
   docker compose -f docker-compose.yml -f infra/docker/compose.secrets.yml up -d --build
   ```
   Em Kubernetes/ECS, monte os mesmos arquivos em `/run/secrets` ou registre um backend
   (`registerSecretBackend`) para Vault/KMS.
3. `SEED=false` (não criar tenants de demonstração) e crie o primeiro tenant/usuário por script
   administrativo; importe o rate card oficial (`pnpm pricing import`) e aposente os DEMO.
4. TLS na borda (proxy reverso/ingress) para API e dashboard; o webhook da Meta exige HTTPS público.
5. `PLATFORM_ADMIN_EMAILS` para a visão de plataforma.

### Alterar `ENCRYPTION_KEY`

Os dados cifrados (telefones, tokens) dependem da chave. Rotação exige reprocessamento (decifrar com a
antiga, cifrar com a nova) — ainda não automatizado (ver LIMITATIONS.md). Guarde a chave com backup seguro.

## Operação

* **Migrações**: `pnpm db:migrate` (ou o serviço `migrate`) antes de subir versões novas da API/worker.
* **Escala**: API e worker sem estado; múltiplos workers são seguros (locks por grupo no PostgreSQL,
  chaves únicas, jobs idempotentes). O limitador de envio é global (Redis).
* **Jobs agendados** (`ENABLE_SCHEDULED_JOBS=true` em ao menos um worker): rollup (10 min), alertas
  (15 min), retenção (diária 06:30 UTC).
* **Backups**: PostgreSQL (dump/PITR). O Redis guarda filas; perdas são recuperáveis porque o estado de
  verdade está no banco, mas jobs em voo podem precisar de reprocessamento.
* **Monitoração**: Prometheus (`/api/v1/metrics`, `worker:9100/metrics`), alertas do próprio WCO
  (custo anômalo, cota, falha de webhook, pagamento, restrição de conta), filas na página Observabilidade.

## Variáveis principais

Veja `.env.example` (comentado). Destaques: `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`,
`HASH_PEPPER`, `SECRET_PROVIDER`, `MOCK_WHATSAPP`, `META_*`, `RATE_LIMIT_PER_MINUTE`,
`DISPATCH_MAX_PER_SECOND`, `WORKER_CONCURRENCY`, `INFRA_COST_PER_MESSAGE_PROCESSED`,
`INFRA_COST_PER_PROVIDER_CALL`, `AI_ASSISTANT_ENABLED` (padrão `false`).
