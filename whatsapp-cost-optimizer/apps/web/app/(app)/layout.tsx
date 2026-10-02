import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { apiBase, serverApi, type Me } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Authenticated area: the session is validated against the API on every navigation. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await serverApi<Me>("auth/me").catch(() => null);
  if (!me) redirect("/login");
  const mode = await fetch(`${apiBase()}/api/v1/health`, { cache: "no-store" })
    .then((r) => r.json() as Promise<{ mode: string; mockWhatsApp: boolean }>)
    .then((h) => ({ mock: h.mockWhatsApp, appMode: h.mode }))
    .catch(() => null);
  const apiDocsUrl = `${(process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/docs`;
  return (
    <Shell me={me} mode={mode} apiDocsUrl={apiDocsUrl}>
      {children}
    </Shell>
  );
}
