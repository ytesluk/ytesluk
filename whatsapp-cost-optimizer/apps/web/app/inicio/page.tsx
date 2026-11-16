import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellOff, Copy, FileSearch, Layers, RefreshCw, ShieldCheck, Timer, Zap } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Calculator } from "@/components/landing/calculator";
import { Demo } from "@/components/landing/demo";
import { Parallax, ScrollStage, Tilt } from "@/components/landing/fx";
import { HeroArt, TornEdge } from "@/components/landing/hero-art";
import painel from "@/components/landing/painel.jpg";
import { PLANS } from "@/components/landing/plans";
import { Scene3D } from "@/components/landing/scene3d";
import { int, money } from "@/lib/format";
import { sessionToken } from "@/lib/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WCO — pare de pagar por mensagem repetida no WhatsApp",
  description: "O WCO fica entre o seu sistema e o WhatsApp oficial: barra avisos repetidos, junta atualizações do mesmo pedido e mostra, linha por linha, o que você deixou de pagar.",
};

const INK = "#0c1712";

const wrap = "mx-auto w-full max-w-[1180px] px-5 sm:px-8";
const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.18em]";
const h2 = "font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-tight text-ink";
const btnPrimary = "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-ink transition hover:opacity-90 active:translate-y-px";

const SITUATIONS = [
  {
    n: "01",
    title: "O pedido mudou de status quatro vezes em doze minutos.",
    body: "Pago, em separação, enviado, saiu para entrega. O sistema avisou a cada passo.",
    paid: "4 mensagens",
    needed: "1 bastava",
  },
  {
    n: "02",
    title: "O mesmo aviso de pagamento foi disparado duas vezes.",
    body: "Uma integração repetiu o envio. O cliente recebeu a mesma informação em dobro.",
    paid: "2 mensagens",
    needed: "1 bastava",
  },
  {
    n: "03",
    title: "Três avisos do mesmo pedido saíram no mesmo minuto.",
    body: "Pagamento aprovado, nota fiscal e separação. Três notificações para dizer uma coisa.",
    paid: "3 mensagens",
    needed: "1 bastava",
  },
];

const FEATURES = [
  { icon: Copy, title: "Barra o que é repetido", body: "Se o mesmo aviso chegar duas vezes, só o primeiro segue. O segundo não vira mensagem nem cobrança." },
  { icon: RefreshCw, title: "Fica com a informação mais recente", body: "Quando um pedido muda de status em sequência, o cliente recebe a situação atual, não o histórico inteiro." },
  { icon: Layers, title: "Junta avisos do mesmo assunto", body: "Avisos que chegam quase juntos sobre o mesmo pedido saem em uma mensagem só." },
  { icon: Timer, title: "Usa as janelas previstas pela Meta", body: "Quando existe uma janela em que a mensagem sai grátis ou mais barata pelas regras da Meta, o WCO envia dentro dela." },
  { icon: Zap, title: "Nunca segura o que é urgente", body: "Código de verificação e alerta crítico saem na hora. Só espera o que pode esperar, pelo tempo que você definir." },
  { icon: BellOff, title: "Respeita quem pediu para parar", body: "Quem responde pedindo para sair deixa de receber. Telefones ficam cifrados e o texto das conversas não é guardado." },
  { icon: FileSearch, title: "Explica cada decisão", body: "Para qualquer mensagem, você abre a auditoria e lê por que foi enviada, segurada, juntada ou barrada." },
  { icon: ShieldCheck, title: "Usa só a API oficial", body: "O envio é feito pela Cloud API da Meta, com o número e a conta da sua empresa." },
];

const FAQ = [
  {
    q: "A economia é garantida?",
    a: "Não, e desconfie de quem garante. O que você deixa de pagar depende de quanto do seu tráfego é repetido ou pode ser juntado. Por isso existe o plano Free: você liga o seu sistema, o WCO mede e o extrato mostra o número real.",
  },
  {
    q: "O WCO atrasa as minhas mensagens?",
    a: "Só as que podem esperar, como atualização de status de pedido, e por um intervalo curto que você configura. Código de verificação e alerta crítico nunca esperam.",
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
    a: "Nada é bloqueado. O WCO avisa que você passou do volume incluído e continua processando normalmente.",
  },
  {
    q: "Preciso de alguém de tecnologia para começar?",
    a: "Para a integração, sim: o seu sistema passa a enviar os avisos para a API do WCO, em vez de enviar direto para o WhatsApp. É uma chamada REST, com documentação aberta.",
  },
  {
    q: "E a LGPD?",
    a: "Telefones são guardados cifrados, o texto das conversas não é armazenado, pedidos de saída são respeitados e há exportação e exclusão de dados por titular.",
  },
];

/**
 * Regions of the dashboard screenshot (left, top, width, height as fractions of the image) that
 * float in front of it on large screens. Measured on the page when the screenshot was taken.
 */
const PANEL_PIECES: Array<{ box: readonly [number, number, number, number]; z: number }> = [
  { box: [0.6824, 0.2936, 0.2941, 0.5875], z: 78 },
  { box: [0.2176, 0.3221, 0.4353, 0.12], z: 44 },
  { box: [0.0118, 0.7991, 0.1699, 0.173], z: 58 },
];

function PanelPiece({ box, z }: { box: readonly [number, number, number, number]; z: number }) {
  const [l, t, w, h] = box;
  return (
    <div
      aria-hidden
      className="float-z hidden lg:block"
      style={{
        left: `${l * 100}%`,
        top: `${t * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        backgroundImage: `url(${painel.src})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${(l / (1 - w)) * 100}% ${(t / (1 - h)) * 100}%`,
        ["--z" as string]: `${z}px`,
      }}
    />
  );
}

function SampleStatement() {
  const rows: Array<[string, string]> = [
    ["Duplicadas barradas", "R$ 148,20"],
    ["Substituídas pela mais recente", "R$ 96,40"],
    ["Juntadas em uma só mensagem", "R$ 71,05"],
    ["Enviadas em janela grátis", "R$ 39,90"],
  ];
  return (
    <div className="receipt-slot theme-paper !bg-transparent">
      <div className="receipt receipt-print px-5 pt-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Extrato · exemplo ilustrativo</p>
        <p className="perf-b pb-3 pt-1 font-display text-xl font-semibold tracking-tight text-ink">O que o WCO evitou</p>
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
        <p className="mt-2 text-[11px] leading-snug text-muted">Valores de exemplo. No seu painel, cada linha vem das suas próprias mensagens.</p>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const logged = !!(await sessionToken());

  return (
    <div className="theme-paper min-h-screen overflow-x-clip">
      {/* Navigation: one paper pill that stays on top. */}
      <div className="sticky top-3 z-50 px-3 sm:px-5">
        <nav aria-label="Navegação do site" className="mx-auto flex max-w-[1180px] items-center gap-1 rounded-full border border-line bg-[#fdfcf8]/95 py-2 pl-4 pr-2 shadow-[0_12px_30px_-18px_rgba(0,0,0,.6)] backdrop-blur">
          <Link href="/inicio" aria-label="WCO, página inicial" className="mr-auto [&_span_span:last-child]:hidden sm:[&_span_span:last-child]:block">
            <Wordmark compact />
          </Link>
          <div className="hidden items-center lg:flex">
            {[
              ["#demo", "Demonstração"],
              ["#como-funciona", "Como funciona"],
              ["#calculadora", "Calculadora"],
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
      <header className="theme-ink relative -mt-[70px] overflow-hidden pt-[70px]" style={{ background: `linear-gradient(180deg, ${INK} 0%, #0f241c 62%, #153427 100%)` }}>
        <div className={`${wrap} relative z-10 grid grid-cols-1 items-start gap-10 pb-[clamp(130px,16vw,215px)] pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(380px,470px)]`}>
          <div>
            <p className={`${eyebrow} text-[#dcf45b]`}>Custo de WhatsApp sob controle</p>
            <h1 className="mt-5 font-display text-[clamp(36px,5.1vw,62px)] font-semibold leading-[1.13] tracking-[-0.025em] text-ink">
              Pare de pagar por mensagem que <span className="marker">ninguém precisava receber.</span>
            </h1>
            <p className="mt-5 max-w-[600px] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
              O WCO fica entre o seu sistema e o WhatsApp oficial. Ele barra avisos repetidos, junta atualizações do mesmo pedido e, no fim do mês, mostra linha por linha o que você deixou de pagar.
            </p>

            <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted">Plano Free com 1.000 avisos por mês · sem cartão · API oficial da Meta</p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <a href="#demo" className="group rounded-2xl bg-[#dcf45b] p-4 text-[#14201b] transition hover:-translate-y-0.5">
                <span className={`${eyebrow} block opacity-70`}>Ver funcionando</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-display text-[17px] font-semibold leading-tight">
                  Assistir à demonstração <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </a>
              <a href="#calculadora" className="group rounded-2xl bg-[#fdfcf8] p-4 text-[#14201b] transition hover:-translate-y-0.5">
                <span className={`${eyebrow} block text-[#0e5a45]`}>Fazer a conta</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-display text-[17px] font-semibold leading-tight">
                  Calcular com meus números <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </a>
              <Link href="/signup" className="group rounded-2xl bg-[#fdfcf8] p-4 text-[#14201b] transition hover:-translate-y-0.5">
                <span className={`${eyebrow} block text-[#0e5a45]`}>Começar agora</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-display text-[17px] font-semibold leading-tight">
                  Criar conta grátis <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </div>
          </div>
          {/* The logo come to life: a 3D machine printing the statement (WebGL, loaded on demand). */}
          <div className="relative h-[390px] sm:h-[520px] lg:h-[600px]">
            <div className="hero-stage">
              <Scene3D
                kind="hero"
                className="block h-full w-full"
                label="Ilustração em 3D: uma pequena impressora verde imprime o extrato do que o WCO evitou; ao redor, uma mensagem entregue e três que não precisaram ser enviadas."
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
        <HeroArt className="pointer-events-none absolute inset-x-0 bottom-0 h-[clamp(190px,25vw,340px)] w-full" />
        <Parallax targetId="hero-art" />
      </header>

      <main>
        {/* The problem */}
        <section className={`${wrap} py-16 sm:py-24`}>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div>
              <p className={`${eyebrow} text-accent`}>O problema</p>
              <h2 className={`${h2} mt-4`}>O WhatsApp cobra por mensagem. O seu sistema dispara sem pensar.</h2>
            </div>
            <p className="self-end text-[17px] leading-relaxed text-ink-2">
              ERP, loja virtual e sistema de logística avisam o cliente a cada mudança, cada um por conta própria. Ninguém confere se o aviso já foi dado, se já ficou velho ou se cabia junto com outro. A conta chega no fim do mês, e boa parte dela é repetição.
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
                  <span className="text-xs text-muted">você pagou</span>
                  <span className="figure text-[15px]">
                    <span className="struck">{s.paid}</span> <span className="marker font-semibold">{s.needed}</span>
                  </span>
                </p>
               </Tilt>
              </article>
            ))}
          </div>
        </section>

        {/* Live demonstration */}
        <section id="demo" className="scroll-mt-24 border-y border-dashed border-rule bg-surface-2/50">
          <div className={`${wrap} py-16 sm:py-24`}>
            <p className={`${eyebrow} text-accent`}>Demonstração</p>
            <h2 className={`${h2} mt-4 max-w-3xl`}>Veja o que entra e o que realmente chega ao cliente.</h2>
            <div className="mt-9">
              <Demo />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className={`${wrap} scroll-mt-24 py-16 sm:py-24`}>
          <p className={`${eyebrow} text-accent`}>Como funciona</p>
          <h2 className={`${h2} mt-4 max-w-3xl`}>Três passos. Nenhuma mudança para o seu cliente.</h2>
          <ol className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-3">
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">
                01
              </p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">Conecte o WhatsApp da empresa</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Você liga a conta comercial oficial da sua empresa ao WCO. O número continua sendo seu e a cobrança das mensagens continua na sua conta da Meta.</p>
            </li>
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">02</p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">Envie os avisos para o WCO</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">O seu sistema manda o que aconteceu, em uma chamada simples. O WCO decide se aquilo vira mensagem agora, depois, junto com outra, ou não vira.</p>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-[#14201b] p-4 font-mono text-[12px] leading-relaxed text-[#dfe6dc]">
                <code>{`POST /api/v1/messages/intents

{
  "customer":  "+5511999990000",
  "eventType": "order.status",
  "entityId":  "ORD-4812",
  "data": { "status": "SHIPPED" }
}`}</code>
              </pre>
            </li>
            <li>
              <p className="figure text-[44px] font-semibold leading-none text-ink">03</p>
              <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">Acompanhe o extrato</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">No painel você vê quanto custaria sem o WCO, quanto custou com ele e de onde veio a diferença. Cada mensagem tem a explicação da decisão.</p>
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
                  <p className="mt-5 text-[17px] leading-relaxed text-ink-2">O painel abre com um extrato: cada linha é um motivo pelo qual você deixou de pagar, e as linhas somam o total destacado.</p>
                  <ul className="mt-7 space-y-4 text-[15px] leading-relaxed text-ink-2">
                    <li className="flex gap-3">
                      <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-rule px-2.5 font-mono text-[10px] uppercase tracking-wide text-ink">Estimado</span>
                      <span>É a conta do WCO, comparando com cada aviso virando uma mensagem.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-[#dcf45b] px-2.5 font-mono text-[10px] uppercase tracking-wide text-[#14201b]">Realizado</span>
                      <span>É o que a própria Meta confirmou na entrega da mensagem.</span>
                    </li>
                  </ul>
                  <p className="mt-6 text-[15px] leading-relaxed text-ink">Os dois aparecem lado a lado e nunca são somados. Você sabe o que é projeção e o que já é fato.</p>
                </div>
                <ScrollStage>
                  <figure>
                    <div className="stage3d-inner relative">
                      <div className="overflow-hidden rounded-2xl border border-line shadow-[0_50px_90px_-40px_rgba(0,0,0,.95)]">
                        <div className="flex h-8 items-center gap-1.5 bg-[#1b2a23] px-4" aria-hidden>
                          <span className="size-2.5 rounded-full bg-[#f4f1e6]/25" />
                          <span className="size-2.5 rounded-full bg-[#f4f1e6]/25" />
                          <span className="size-2.5 rounded-full bg-[#f4f1e6]/25" />
                        </div>
                        {/* Bundled static asset: served as-is, no image optimizer needed. */}
                        <img src={painel.src} width={painel.width} height={painel.height} alt="Painel do WCO: a frase “Você deixou de pagar”, a comparação de custo sem e com o WCO e o extrato com cada linha do que foi evitado." loading="lazy" className="block h-auto w-full" />
                      </div>
                      {/* The same screen, taken apart: these pieces float in front of it. */}
                      <div className="absolute inset-x-px bottom-px top-[33px] [transform-style:preserve-3d]">
                        {PANEL_PIECES.map((piece) => (
                          <PanelPiece key={piece.z} {...piece} />
                        ))}
                      </div>
                    </div>
                    <figcaption className="mt-6 font-mono text-[11px] uppercase tracking-wider text-muted">Tela real do painel, com dados de demonstração</figcaption>
                  </figure>
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
              <p className={`${eyebrow} text-accent`}>O que ele faz</p>
              <h2 className={`${h2} mt-4`}>Decide, mensagem por mensagem, o caminho mais barato dentro das regras.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">Sem mexer no texto que o seu cliente lê e sem tirar do ar o que é urgente.</p>
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

        {/* Calculator */}
        <section id="calculadora" className="scroll-mt-24 border-y border-dashed border-rule bg-surface-2/50">
          <div className={`${wrap} py-16 sm:py-24`}>
            <p className={`${eyebrow} text-accent`}>Calculadora</p>
            <h2 className={`${h2} mt-4 max-w-3xl`}>Faça a conta com os seus números.</h2>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2">Três perguntas. O recibo ao lado mostra quanto você deixaria de pagar e se a assinatura se paga.</p>
            <div className="mt-10">
              <Calculator />
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="planos" className={`${wrap} scroll-mt-24 py-16 sm:py-24`}>
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
            Descubra quanto da sua conta de WhatsApp é <span className="marker">mensagem repetida.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">Ligue o seu sistema no plano Free. Em poucos dias o extrato mostra o número, com os seus próprios dados.</p>
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
              <a href="#demo" className="hover:text-ink">Demonstração</a>
              <a href="#como-funciona" className="hover:text-ink">Como funciona</a>
              <a href="#planos" className="hover:text-ink">Planos</a>
              <a href="#duvidas" className="hover:text-ink">Dúvidas</a>
              {process.env.TERMS_URL ? <a href={process.env.TERMS_URL} className="hover:text-ink">Termos de uso</a> : null}
              {process.env.PRIVACY_URL ? <a href={process.env.PRIVACY_URL} className="hover:text-ink">Privacidade</a> : null}
            </nav>
          </div>
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted">WhatsApp é uma marca da Meta Platforms, Inc. O WCO é um produto independente, sem vínculo com a Meta, e envia mensagens exclusivamente pela API oficial (Cloud API).</p>
        </div>
      </footer>
    </div>
  );
}
