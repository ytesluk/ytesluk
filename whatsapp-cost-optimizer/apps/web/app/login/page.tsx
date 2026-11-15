"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthFrame } from "@/components/brand";
import { Button, Field, Input, Notice } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => setExpired(new URLSearchParams(window.location.search).has("expired")), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.status === 429
          ? "Muitas tentativas. Aguarde um minuto."
          : res.status === 403
            ? "Origem não permitida: este endereço não está liberado no servidor (configure WEB_ALLOWED_ORIGINS)."
            : res.status === 401
              ? "E-mail ou senha inválidos."
              : `Não foi possível entrar (erro ${res.status}). Verifique se a API está no ar.`,
      );
      return;
    }
    const { user } = (await res.json()) as { user?: { role?: string } };
    window.location.href = user?.role === "OPERATOR" ? "/messages" : "/";
  };

  return (
    <AuthFrame title="Entrar" lead="Acompanhe o custo do WhatsApp da sua empresa e o que deixou de ser pago.">
      <form onSubmit={submit} className="space-y-4">
        {expired ? <Notice tone="warning">Sua sessão expirou. Entre novamente.</Notice> : null}
        <Field label="E-mail">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha">
          <Input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="h-11 w-full" loading={busy}>
          Entrar
        </Button>
      </form>
      <p className="perf-t mt-6 pt-5 text-sm text-ink-2">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="font-semibold text-accent underline-offset-4 hover:underline">
          Criar conta grátis
        </Link>
      </p>
      <p className="mt-2 text-[11px] text-muted">Ambiente de desenvolvimento: usuários de demonstração são criados por <code>pnpm db:seed</code>.</p>
    </AuthFrame>
  );
}
