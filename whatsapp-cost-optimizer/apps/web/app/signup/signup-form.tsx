"use client";

import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";

const ERRORS: Record<number, string> = {
  409: "Já existe uma conta com este e-mail. Entre com ele ou use outro.",
  429: "Muitas tentativas. Aguarde um minuto.",
};

function DocLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

export function SignupForm({ termsUrl, privacyUrl }: { termsUrl: string | null; privacyUrl: string | null }) {
  const [f, setF] = useState({ companyName: "", name: "", email: "", password: "", acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    const res = await fetch("/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, timezone }) });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
      setError(
        ERRORS[res.status] ??
          (res.status === 403
            ? body.error?.message === "Origem inválida"
              ? "Origem não permitida: este endereço não está liberado no servidor (configure WEB_ALLOWED_ORIGINS)."
              : "O cadastro está desativado neste ambiente. Fale com o administrador."
            : res.status === 400
              ? "Confira os dados: e-mail válido, senha com pelo menos 10 caracteres e aceite dos termos."
              : `Não foi possível criar a conta (erro ${res.status}). Verifique se a API está no ar.`),
      );
      return;
    }
    window.location.href = "/admin/providers?welcome=1";
  };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Brand />
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <div>
            <h2 className="text-base font-semibold text-ink">Criar conta</h2>
            <p className="mt-1 text-sm text-muted">Plano Free, sem cartão. Depois você conecta o WhatsApp da sua empresa.</p>
          </div>
          <Field label="Nome da empresa">
            <Input autoComplete="organization" required minLength={2} maxLength={120} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
          </Field>
          <Field label="Seu nome">
            <Input autoComplete="name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="E-mail de trabalho">
            <Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Senha" hint="Pelo menos 10 caracteres.">
            <Input type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" required checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} />
            <span>
              Li e aceito os <DocLink href={termsUrl}>termos de uso</DocLink> e a <DocLink href={privacyUrl}>política de privacidade</DocLink>.
            </span>
          </label>
          {error ? (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Criar conta
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
