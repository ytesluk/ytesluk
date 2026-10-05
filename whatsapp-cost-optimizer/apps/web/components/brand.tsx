import { Gauge } from "lucide-react";

/** Product mark used on the public pages (login, signup). */
export function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-accent text-white">
        <Gauge className="size-5" aria-hidden />
      </span>
      <div>
        <h1 className="text-lg font-semibold text-ink">WhatsApp Cost Optimizer</h1>
        <p className="text-xs text-muted">Custo de WhatsApp sob controle, com evidência</p>
      </div>
    </div>
  );
}
