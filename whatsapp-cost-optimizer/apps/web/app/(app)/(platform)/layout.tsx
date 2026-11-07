import { redirect } from "next/navigation";
import { serverApi, type Me } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Internal tools of the SaaS operator (observability, simulators, A–F experiment, rate cards,
 * policies). Client companies do not see them; only PLATFORM_ADMIN_EMAILS can open these pages.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const me = await serverApi<Me>("auth/me").catch(() => null);
  if (!me?.actor.platformAdmin) redirect("/");
  return children;
}
