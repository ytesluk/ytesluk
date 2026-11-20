import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileSearch, Gauge, Lock, ShieldCheck, TrendingDown, Wallet } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Parallax, ScrollStage, Tilt } from "@/components/landing/fx";
import { HeroArt, TornEdge } from "@/components/landing/hero-art";
import heroPosterLiteNarrow from "@/components/landing/hero-poster-lite-narrow.webp";
import heroPosterLite from "@/components/landing/hero-poster-lite.webp";
import heroPosterNarrow from "@/components/landing/hero-poster-narrow.webp";
import heroPoster from "@/components/landing/hero-poster.webp";
import { tierScript } from "@/components/landing/three/tier";
import { NARROW_QUERY } from "@/components/landing/three/frame";
import { PLANS } from "@/components/landing/plans";
import { MotionSwitch } from "@/components/landing/motion-switch";
import { PanelShowcase } from "@/components/landing/panel-showcase";
import { Scene3D } from "@/components/landing/scene3d";
import { int, money } from "@/lib/numbers";
import { sessionToken } from "@/lib/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WCO — corte a fatura do WhatsApp sem mudar a sua operação",
  description: "Inteligência financeira para o WhatsApp oficial da sua empresa: a fatura da Meta fica menor, as mensagens urgentes continuam saindo na hora e o painel prova cada real economizado.",
};

const INK = "#0c1712";

const wrap = "mx-auto w-full max-w-[1180px] px-5 sm:px-8";
const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.18em]";
const h2 = "font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-tight text-ink";
const btnPrimary = "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-ink transition hover:opacity-90 active:translate-y-px";

const SITUATIONS = [
  {
    n: "01",
    title: "A fatura do WhatsApp veio maior, e ninguém sabe explicar.",
    body: "O custo subiu, mas não existe relatório que mostre para onde o dinheiro foi nem quanto dele era necessário.",
    label: "visibilidade",
    before: "nenhuma",
    after: "linha a linha",
  },
  {
    n: "02",
    title: "Cada venda nova traz junto mais custo de mensagem.",
    body: "O volume cresce, a conta da Meta cresce na mesma proporção e a margem de cada pedido encolhe sem alarde.",
    label: "margem",
    before: "corroída",
    after: "protegida",
  },
  {
    n: "03",
    title: "O orçamento do mês nunca bate com a fatura.",
    body: "O custo varia de um mês para o outro, e o financeiro só descobre o valor real quando a cobrança chega.",
    label: "orçamento",
    before: "estourado",
    after: "previsível",
  },
];

const FEATURES = [
  { icon: Wallet, title: "Fatura menor, todo mês", body: "A conta da Meta passa a ser só o que precisa ser. Você acompanha a economia no painel desde o primeiro dia." },
  { icon: TrendingDown, title: "Margem protegida", body: "Vender mais deixa de significar pagar proporcionalmente mais por mensagem. O custo por cliente fica sob controle." },
  { icon: Gauge, title: "Custo previsível", body: "Acompanhe o gasto do mês enquanto ele acontece, com alerta quando o volume passa do previsto no seu plano." },
  { icon: FileSearch, title: "Auditoria de cada real", body: "Economia estimada e economia confirmada pela Meta lado a lado, nunca somadas. Cada envio fica registrado." },
  { icon: Lock, title: "LGPD desde o primeiro dia", body: "Telefones cifrados, conteúdo das conversas não armazenado e pedidos de saída respeitados automaticamente." },
  { icon: ShieldCheck, title: "Só a API oficial", body: "O envio é feito pela Cloud API da Meta, com o número e a conta da sua empresa. Nada de atalho." },
];

const FAQ = [
  {
    q: "Quanto eu vou economizar?",
    a: "Depende do seu volume e do perfil dos seus envios. Por isso existe o plano Free: você conecta o WhatsApp da empresa e o extrato mostra, com os seus próprios dados, quanto saiu da fatura. Você decide com o número real na mão, não com promessa.",
  },
  {
    q: "Como o WCO reduz a fatura?",
    a: "Com uma camada de inteligência própria que avalia cada envio antes de ele chegar à Meta, sempre dentro das regras oficiais do WhatsApp. Você não precisa configurar estratégia nenhuma: o resultado aparece no extrato, linha a linha.",
  },
  {
    q: "As mensagens urgentes ficam mais lentas?",
    a: "Não. Código de verificação e alertas críticos saem na hora, sempre. Você define quais avisos são prioridade para a sua operação, e eles nunca esperam.",
  },
  {
    q: "Preciso trocar de número ou sair da API oficial?",
    a: "Não. O WCO envia pela Cloud API oficial da Meta usando o número e a conta comercial da sua empresa.",
  },
  {
    q: "Quem cobra as mensagens de WhatsApp?",
    a: "A Meta, direto na forma de pagamento da sua conta, como já é hoje. O WCO cobra apenas a assinatura do plano.",
  },
  {
    q: "O que acontece se eu passar do limite do plano?",
    a: "Nada é bloqueado. O WCO avisa que você passou do volume incluído e continua funcionando normalmente.",
  },
  {
    q: "E a LGPD?",
    a: "Telefones são guardados cifrados, o texto das conversas não é armazenado, pedidos de saída são respeitados e há exportação e exclusão de dados por titular.",
  },
];

const still = (img: { src: string; width: number; height: number }) => ({ src: img.src, width: img.width, height: img.height });

function SampleStatement() {
  const rows: Array<[string, string]> = [
    ["Otimização de fluxo operacional", "R$ 148,20"],
    ["Eliminação de disparos redundantes", "R$ 96,40"],
    ["Consolidação inteligente de envios", "R$ 71,05"],
    ["Aproveitamento de tarifa zero", "R$ 39,90"],
  ];
  return (
    <div className="receipt-slot theme-paper !bg-transparent">
      <div className="receipt receipt-print px-5 pt-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Extrato · exemplo ilustrativo</p>
        <p className="perf-b pb-3 pt-1 font-display text-xl font-semibold tracking-tight text-ink">Sua economia no mês</p>
        <div className="perf-b py-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 py-1 text-[12.5px] text-ink-2">
              <span>{k}</span>
              <span className="mb-1 min-w-4 flex-1 border-b border-dotted border-rule" aria-hidden />
              <span className="figure text-ink">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-2 pt-3 text-[13px] font-semibold text-ink">
          <span>Você deixou de pagar</span>
          <span className="figure text-lg">
            <span className="marker">R$ 355,55</span>
          </span>
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">De cada 100 disparos da operação: 78 faturados · 22 economizados</p>
        <p className="mt-1 text-[11px] leading-snug text-muted">Valores de exemplo. No seu painel, cada linha vem da sua própria operação.</p>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const logged = !!(await sessionToken());

  return (
    <div className="theme-paper min-h-screen overflow-x-clip">
      {/* Before anything paints: how this device draws 3D, and the matching picture of the printer. */}
      <script
        dangerouslySetInnerHTML={{
          __html: tierScript({ full: { wide: heroPoster.src, narrow: heroPosterNarrow.src }, lite: { wide: heroPosterLite.src, narrow: heroPosterLiteNarrow.src } }, NARROW_QUERY),
        }}
      />
      {/* Navigation: one paper pill that stays on top. */}
      <div className="sticky top-3 z-50 px-3 sm:px-5">
        <nav aria-label="Navegação do site" className="mx-auto flex max-w-[1180px] items-center gap-1 rounded-full border border-line bg-[#fdfcf8] py-2 pl-4 pr-2 shadow-[0_12px_30px_-18px_rgba(0,0,0,.6)]">
          <Link href="/inicio" aria-label="WCO, página inicial" className="mr-auto [&_span_span:last-child]:hidden sm:[&_span_span:last-child]:block">
            <Wordmark compact />
          </Link>
          <div className="hidden items-center lg:flex">
            {[
              ["#como-funciona", "Como funciona"],
              ["#planos", "Planos"],
              ["#duvidas", "Dúvidas"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[14px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
                {label}
              </a>
            ))}
          </div>
          {logged ? (
            <Link href="/" className="ml-2 inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink hover:opacity-90">
              Abrir o painel <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-3.5 py-2 text-[14px] font-semibold text-ink hover:bg-surface-2">
                Entrar
              </Link>
              <Link href="/signup" className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink hover:opacity-90 sm:px-5">
                Criar conta grátis
              </Link>
            </>
          )}
        </nav>
      </div>

      {/* Hero */}
      <header className="theme-ink relative -mt-[70px] overflow-clip pt-[70px]" style={{ background: `linear-gradient(180deg, ${INK} 0%, #0f241c 62%, #153427 100%)` }}>
        <div className={`${wrap} relative z-10 grid grid-cols-1 items-start gap-10 pb-[clamp(130px,16vw,215px)] pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(380px,470px)] lg:items-stretch`}>
          <div>
            <p className={`${eyebrow} text-[#dcf45b]`}>Inteligência financeira para WhatsApp</p>
            <h1 className="mt-5 font-display text-[clamp(36px,5.1vw,62px)] font-semibold leading-[1.13] tracking-[-0.025em] text-ink">
              Corte a fatura do WhatsApp <span className="marker">sem mexer na operação.</span>
            </h1>
            <p className="mt-5 max-w-[600px] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
              O WCO se conecta ao seu WhatsApp oficial para cortar gastos desnecessários na sua fatura, sem mudar nada na sua operação. Chega de pagar caro pelo WhatsApp no fim do mês por mensagens enviadas.
            </p>

            <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted">Plano Free com 1.000 avisos por mês · sem cartão · API oficial da Meta</p>

            <div className="mt-8 grid max-w-[600px] grid-cols-1 gap-3 sm:grid-cols-2">
              <a href="#como-funciona" className="group rounded-2xl bg-[#dcf45b] p-4 text-[#14201b] transition hover:-translate-y-0.5">
                <span className={`${eyebrow} block opacity-70`}>Em 1 minuto</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-display text-[17px] font-semibold leading-tight">
                  Entender como funciona <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </a>
              <Link href="/signup" className="group rounded-2xl bg-[#fdfcf8] p-4 text-[#14201b] transition hover:-translate-y-0.5">
                <span className={`${eyebrow} block text-[#0e5a45]`}>Começar agora</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-display text-[17px] font-semibold leading-tight">
                  Criar conta grátis <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </div>

            <div id="hero-closeup" className="hidden pb-[24vh] pt-[44vh] lg:block">
              <p className={`${eyebrow} text-[#dcf45b]`}>A prova</p>
              <h2 className="mt-4 max-w-[520px] font-display text-[clamp(28px,3.4vw,44px)] font-semibold leading-[1.1] tracking-tight text-ink">Cada real economizado sai impresso.</h2>
              <p className="mt-5 max-w-[500px] text-[17px] leading-relaxed text-ink-2">
                Acompanhe no extrato exatamente quanto sua operação deixou de gastar. O painel separa a economia projetada pelo WCO do valor já validado na fatura da Meta, sem números inflados.
              </p>
              <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-muted">Gire a impressora com o mouse. Clique nela para imprimir outro extrato.</p>
            </div>
          </div>
          {/* A thermal printer rendered like a product photo, printing the statement (WebGL, loaded on demand).
              On large screens the stage stays pinned while the left column scrolls on to the close-up. */}
          <div className="relative [touch-action:pan-y]">
            <div className="hero-pin relative h-[430px] sm:h-[560px]">
              <div className="hero-stage">
                <Scene3D
                  kind="hero"
                  focusId="hero-closeup"
                  poster={{
                    full: { wide: still(heroPoster), narrow: still(heroPosterNarrow) },
                    lite: { wide: still(heroPosterLite), narrow: still(heroPosterLiteNarrow) },
                  }}
                  className="block h-full w-full"
                  label="Cena em 3D: uma impressora térmica verde imprime o extrato de economia do mês, com o total destacado em marca-texto. Ao redor, os contornos dos custos que saíram da fatura."
                  hint="Arraste para girar · clique para imprimir"
                  fallback={
                    <div className="flex h-full items-start justify-center pt-10 lg:pl-24">
                      <div className="w-full max-w-[360px] rotate-[2.2deg]">
                        <SampleStatement />
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
        <HeroArt className="pointer-events-none absolute inset-x-0 bottom-0 h-[clamp(190px,25vw,340px)] w-full" />
        <Parallax targetId="hero-art" />
      </header>

      <main>
        {/* The problem */}
        <section className={`${wrap} py-16 sm:py-24`}>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div>
              <p className={`${eyebrow} text-accent`}>O problema</p>
              <h2 className={`${h2} mt-4`}>A conta do WhatsApp cresce todo mês. E ninguém sabe dizer por quê.</h2>
            </div>
            <p className="self-end text-[17px] leading-relaxed text-ink-2">
              Cada WhatsApp da empresa fala com o cliente por conta própria, e a Meta cobra por mensagem. O resultado é uma fatura que sobe com o volume, difícil de prever e impossível de auditar. E uma parte dela é dinheiro que não precisava sair do caixa.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {SITUATIONS.map((s) => (
              <article key={s.n} className="flex">
               <Tilt className="flex w-full flex-col rounded-3xl border border-line bg-surface p-6">
                <p className={`${eyebrow} text-muted`}>Situação {s.n}</p>
                <h3 className="mt-4 font-display text-[21px] font-semibold leading-snug tracking-tight text-ink">{s.title}</h3>
                <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                <p className="lift perf-t mt-6 flex items-baseline justify-between gap-3 pt-4">
                  <span className="text-xs text-muted">{s.label}</span>
                  <span className="figure text-[15px]">
                    <span className="struck">{s.before}</span> <span className="marker font-semibold">{s.after}</span>
                  </span>
                </p>
               </Tilt>
              </article>
            ))}
          </div>
        </section>

        {/* How it works, in one picture */}
        <section id="como-funciona" className="scroll-mt-24 border-y border-dashed border-rule bg-surface-2/50">
          <div className={`${wrap} py-16 sm:py-24`}>
            <p className={`${eyebrow} text-accent`}>Como funciona</p>
            <h2 className={`${h2} mt-4 max-w-3xl`}>Uma camada inteligente entre o seu WhatsApp e a Meta.</h2>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2">Você não muda nada do que já faz. O WCO trabalha no meio do caminho e o resultado aparece na fatura.</p>
            <div className="mt-10">
              <HowItWorks />
            </div>
          </div>
        </section>

        {/* Getting started */}
        <section id="comecar" className={`${wrap} scroll-mt-24 py-16 sm:py-24`}>
          <p className={`${eyebrow} text-accent`}>Para começar</p>
          <h2 className={`${h2} mt-4 max-w-3xl`}>Três passos. Nenhuma mudança na sua operação.</h2>
          <ol className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-3">
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">
                01
              </p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">Conecte o WhatsApp da empresa</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Você liga a conta comercial oficial da sua empresa ao WCO. O número continua sendo seu, e a cobrança das mensagens, na sua conta da Meta.</p>
            </li>
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">02</p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">O WCO entra em ação</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">A partir daí, cada envio passa pela inteligência do WCO antes de chegar à Meta. Ninguém da sua equipe precisa mudar a rotina.</p>
            </li>
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">03</p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">Acompanhe a economia</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">No painel você vê quanto custaria sem o WCO, quanto custou com ele e quanto a Meta já confirmou. Tudo registrado, pronto para auditoria.</p>
            </li>
          </ol>
        </section>

        {/* The statement: proof */}
        <section id="extrato" className="scroll-mt-24">
          <TornEdge color={INK} seed={9} className="block h-5 w-full sm:h-6" />
          <div className="theme-ink" style={{ background: INK }}>
            <div className={`${wrap} py-16 sm:py-24`}>
              <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div>
                  <p className={`${eyebrow} text-[#dcf45b]`}>O extrato</p>
                  <h2 className={`${h2} mt-4`}>Economia com prova, não com promessa.</h2>
                  <p className="mt-5 text-[17px] leading-relaxed text-ink-2">Abra o painel e veja, em um número só, quanto a sua empresa deixou de pagar no mês, comparado com o que a mesma operação custaria sem o WCO.</p>
                  <ul className="mt-7 space-y-4 text-[15px] leading-relaxed text-ink-2">
                    <li className="flex gap-3">
                      <span className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[#f4f1e6]/10 px-2.5 font-mono text-[10px] uppercase tracking-wide text-ink">
                        <span className="size-1.5 rounded-full bg-[#f4f1e6]/60" aria-hidden />
                        Estimado
                      </span>
                      <span>A economia calculada pelo WCO no momento de cada envio.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[#dcf45b] px-2.5 font-mono text-[10px] uppercase tracking-wide text-[#14201b]">
                        <Check className="size-3" strokeWidth={3} aria-hidden />
                        Realizado
                      </span>
                      <span>A economia que a própria Meta já confirmou na cobrança.</span>
                    </li>
                  </ul>
                  <p className="mt-6 text-[15px] leading-relaxed text-ink">Os dois aparecem lado a lado e nunca são somados. Você sabe o que é projeção e o que já é fato.</p>
                </div>
                <ScrollStage>
                  <PanelShowcase />
                </ScrollStage>
              </div>
            </div>
          </div>
          <TornEdge color={INK} seed={21} flip className="block h-5 w-full sm:h-6" />
        </section>

        {/* What it does */}
        <section className={`${wrap} py-16 sm:py-24`}>
          <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className={`${eyebrow} text-accent`}>O que você ganha</p>
              <h2 className={`${h2} mt-4`}>Margem protegida, sem abrir mão da velocidade.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">Sem mexer no texto que o seu cliente lê e sem trocar de número.</p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="border-t border-dashed border-rule py-6 sm:px-5 sm:odd:pl-0 sm:even:border-l">
                  <f.icon className="size-5 text-accent" aria-hidden />
                  <h3 className="mt-3 font-display text-[18px] font-semibold tracking-tight text-ink">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section id="planos" className={`${wrap} scroll-mt-24 pb-16 sm:pb-24`}>
          <div className="border-t border-dashed border-rule pt-16 sm:pt-24">
            <p className={`${eyebrow} text-accent`}>Planos</p>
            <h2 className={`${h2} mt-4 max-w-3xl`}>Comece de graça. Mude de plano quando o volume pedir.</h2>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((p) => (
                <article key={p.code} className="flex">
                 <Tilt max={5} className={`flex w-full flex-col rounded-3xl border p-6 ${p.code === "FREE" ? "border-transparent bg-[#14201b] text-[#f4f1e6]" : "border-line bg-surface"}`}>
                  <h3 className="font-display text-[20px] font-semibold tracking-tight">{p.name}</h3>
                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className={p.fee === null ? "font-display text-[26px] font-semibold leading-[30px]" : "figure text-[30px] font-semibold leading-none"}>{p.fee === null ? "Sob consulta" : p.fee === 0 ? "R$ 0" : money(p.fee, "BRL", 0)}</span>
                    {p.fee ? <span className={`text-sm ${p.code === "FREE" ? "opacity-70" : "text-muted"}`}>/mês</span> : null}
                  </p>
                  <p className={`mt-4 text-[14.5px] font-medium ${p.code === "FREE" ? "" : "text-ink"}`}>
                    {p.fee === null ? "Acima de 500.000 avisos por mês" : (
                      <>
                        Até <span className={p.code === "FREE" ? "marker figure" : "figure"}>{int(p.events)}</span> avisos por mês
                      </>
                    )}
                  </p>
                  <p className={`mt-2 flex-1 text-[14px] leading-relaxed ${p.code === "FREE" ? "opacity-80" : "text-ink-2"}`}>{p.blurb}</p>
                  {p.code === "FREE" ? (
                    <Link href="/signup" className="lift mt-6 inline-flex h-11 items-center justify-center rounded-full bg-[#dcf45b] px-5 text-sm font-semibold text-[#14201b] hover:opacity-90">
                      Criar conta grátis
                    </Link>
                  ) : (
                    <Link href="/signup" className="lift mt-6 inline-flex h-11 items-center justify-center rounded-full border border-rule bg-surface px-5 text-sm font-semibold text-ink hover:bg-surface-2">
                      Começar pelo Free
                    </Link>
                  )}
                 </Tilt>
                </article>
              ))}
            </div>
            <ul className="mt-7 grid grid-cols-1 gap-x-10 gap-y-2 text-[14px] leading-relaxed text-ink-2 md:grid-cols-3">
              <li className="border-t border-dashed border-rule pt-3">As mensagens de WhatsApp continuam cobradas pela Meta, direto na sua conta.</li>
              <li className="border-t border-dashed border-rule pt-3">Passar do volume incluído não bloqueia nenhuma mensagem.</li>
              <li className="border-t border-dashed border-rule pt-3">Toda conta começa no Free. A mudança de plano é feita com a nossa equipe.</li>
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="duvidas" className={`${wrap} scroll-mt-24 pb-16 sm:pb-24`}>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 border-t border-dashed border-rule pt-16 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)]">
            <div>
              <p className={`${eyebrow} text-accent`}>Dúvidas</p>
              <h2 className={`${h2} mt-4`}>O que perguntam antes de começar.</h2>
            </div>
            <div>
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-dashed border-rule">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-[18px] font-semibold tracking-tight text-ink [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-rule text-lg font-normal leading-none text-ink-2 transition group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Closing call + footer */}
      <TornEdge color={INK} seed={33} className="block h-5 w-full sm:h-6" />
      <footer className="theme-ink relative overflow-hidden" style={{ background: INK }}>
        <div className="slips-stage" aria-hidden>
          <Scene3D kind="slips" className="block h-full w-full" />
        </div>
        <div className={`${wrap} relative py-16 sm:py-24`}>
          <h2 className="max-w-4xl font-display text-[clamp(32px,5vw,60px)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
            Descubra quanto da sua fatura <span className="marker">pode ficar no seu caixa.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">Conecte o WhatsApp da sua empresa no plano Free. Em poucos dias o extrato mostra o número, com os seus próprios dados.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={logged ? "/" : "/signup"} className={`${btnPrimary} !bg-[#dcf45b] !text-[#14201b]`}>
              {logged ? "Abrir o painel" : "Criar conta grátis"} <ArrowRight className="size-4" aria-hidden />
            </Link>
            {logged ? null : (
              <Link href="/login" className="inline-flex h-12 items-center justify-center rounded-full border border-rule px-6 text-[15px] font-semibold text-ink hover:bg-white/5">
                Já tenho conta
              </Link>
            )}
          </div>

          <div className="mt-16 flex flex-wrap items-start justify-between gap-8 border-t border-dashed border-rule pt-8">
            <Wordmark compact />
            <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              <a href="#como-funciona" className="hover:text-ink">Como funciona</a>
              <a href="#planos" className="hover:text-ink">Planos</a>
              <a href="#duvidas" className="hover:text-ink">Dúvidas</a>
              {process.env.TERMS_URL ? <a href={process.env.TERMS_URL} className="hover:text-ink">Termos de uso</a> : null}
              {process.env.PRIVACY_URL ? <a href={process.env.PRIVACY_URL} className="hover:text-ink">Privacidade</a> : null}
              <MotionSwitch className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-ink" />
            </nav>
          </div>
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted">WhatsApp é uma marca da Meta Platforms, Inc. O WCO é um produto independente, sem vínculo com a Meta, e envia mensagens exclusivamente pela API oficial (Cloud API).</p>
        </div>
      </footer>
    </div>
  );
}
