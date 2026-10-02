import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * SecretProvider abstraction (spec §23). The application never reads secrets directly from
 * `process.env` outside this module.
 *
 *  - development: environment variables; missing keys fall back to deterministic, clearly-labelled
 *    development values (never accepted in production).
 *  - docker:      Docker/Kubernetes secrets mounted as files (/run/secrets/<name in lower case>),
 *                 falling back to environment variables.
 *  - production:  delegates to an external backend (AWS Secrets Manager, GCP Secret Manager,
 *                 HashiCorp Vault...) registered with `registerSecretBackend`. Until a backend is
 *                 registered it reads environment variables injected by the platform's secret manager
 *                 and REFUSES development fallbacks.
 */
export interface SecretProvider {
  readonly name: "development" | "docker" | "production";
  get(name: SecretName): string | undefined;
  require(name: SecretName): string;
}

export type SecretName =
  | "ENCRYPTION_KEY"
  | "JWT_SECRET"
  | "HASH_PEPPER"
  | "META_APP_SECRET"
  | "META_ACCESS_TOKEN"
  | "META_WEBHOOK_VERIFY_TOKEN"
  | "AI_ASSISTANT_API_KEY";

export interface SecretBackend {
  get(name: SecretName): string | undefined;
}

let externalBackend: SecretBackend | undefined;

/** Hook for production deployments to plug a secret manager client. */
export function registerSecretBackend(backend: SecretBackend): void {
  externalBackend = backend;
}

/** Deterministic development-only values so `pnpm dev` works out of the box. */
function devFallback(name: SecretName): string | undefined {
  const seed = (label: string) => createHash("sha256").update(`wco-dev-only:${label}`).digest();
  switch (name) {
    case "ENCRYPTION_KEY":
      return seed("encryption").toString("base64");
    case "JWT_SECRET":
      return seed("jwt").toString("hex");
    case "HASH_PEPPER":
      return seed("pepper").toString("hex");
    case "META_WEBHOOK_VERIFY_TOKEN":
      return "wco-dev-verify-token";
    case "META_APP_SECRET":
      return "wco-dev-app-secret";
    default:
      return undefined;
  }
}

class EnvSecretProvider implements SecretProvider {
  constructor(
    readonly name: "development" | "production",
    private readonly env: Record<string, string | undefined>,
    private readonly allowDevFallback: boolean,
  ) {}

  get(name: SecretName): string | undefined {
    const external = externalBackend?.get(name);
    if (external) return external;
    const v = this.env[name];
    if (v && v.trim() !== "") return v.trim();
    return this.allowDevFallback ? devFallback(name) : undefined;
  }

  require(name: SecretName): string {
    const v = this.get(name);
    if (!v) throw new Error(`Secret ${name} is not configured (provider: ${this.name})`);
    return v;
  }
}

class DockerSecretProvider implements SecretProvider {
  readonly name = "docker" as const;
  constructor(
    private readonly dir: string,
    private readonly env: Record<string, string | undefined>,
    private readonly allowDevFallback: boolean,
  ) {}

  get(name: SecretName): string | undefined {
    const file = join(this.dir, name.toLowerCase());
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    const v = this.env[name];
    if (v && v.trim() !== "") return v.trim();
    return this.allowDevFallback ? devFallback(name) : undefined;
  }

  require(name: SecretName): string {
    const v = this.get(name);
    if (!v) throw new Error(`Secret ${name} is not configured (provider: docker)`);
    return v;
  }
}

export function createSecretProvider(opts: {
  kind: "development" | "docker" | "production";
  appMode: "development" | "production";
  env: Record<string, string | undefined>;
  secretsDir: string;
}): SecretProvider {
  const allowDevFallback = opts.appMode === "development";
  switch (opts.kind) {
    case "docker":
      return new DockerSecretProvider(opts.secretsDir, opts.env, allowDevFallback);
    case "production":
      return new EnvSecretProvider("production", opts.env, false);
    default:
      return new EnvSecretProvider("development", opts.env, allowDevFallback);
  }
}
