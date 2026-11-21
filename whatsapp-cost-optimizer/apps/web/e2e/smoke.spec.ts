import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "wco-demo-2026!";
/** Must be listed in the API's PLATFORM_ADMIN_EMAILS (internal tools: simulator, rate cards, ...). */
const PLATFORM_ADMIN = process.env.E2E_PLATFORM_ADMIN ?? "admin@loja-demo.wco.dev";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("anonymous visitors see the product page at / and are sent to login from the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Corte a fatura do WhatsApp");
  await expect(page.getByRole("link", { name: "Criar conta grátis" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Como funciona" }).first().click();
  await expect(page.getByRole("heading", { name: "O WCO", exact: true })).toBeVisible();
  await page.goto("/messages");
  await expect(page).toHaveURL(/\/login/);
});

test("rejects wrong credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("owner@loja-demo.wco.dev");
  await page.getByLabel("Senha").fill("wrong-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
});

test("owner sees overview KPIs, DEMO label and charts with table view", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
  await expect(page.getByText("Custo sem WCO (estimado)")).toBeVisible();
  await expect(page.getByText("TARIFAS DEMO").first()).toBeVisible();
  await page.getByRole("tab", { name: "Tabela" }).first().click();
  await expect(page.getByRole("columnheader", { name: "Dia" }).first()).toBeVisible();
});

test("company users don't see the operator's internal tools; the optimization breakdown is on the overview", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  const nav = page.getByRole("navigation", { name: "Navegação principal" }).first();
  await expect(nav.getByRole("link").first()).toHaveText("Visão geral");
  for (const name of ["Preços", "Políticas", "Simular economia", "Experimento A–F", "Observabilidade", "Otimização"]) {
    await expect(nav.getByRole("link", { name })).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "Onde a economia acontece" })).toBeVisible();
  await page.goto("/simulator");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/optimization");
  await expect(page.getByRole("heading", { name: "Onde a economia acontece" })).toBeVisible();
});

test("savings simulator returns an estimated result", async ({ page }) => {
  await login(page, PLATFORM_ADMIN);
  await page.goto("/simulator");
  await page.getByRole("button", { name: "Simular economia" }).click();
  await expect(page.getByText("Resultado estimado")).toBeVisible();
  await expect(page.getByText("nunca é economia garantida")).toBeVisible();
});

test("message audit explains the decision", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  await page.goto("/messages");
  await page.locator('a[href^="/messages/"]').first().click();
  await expect(page.getByText("Por quê?")).toBeVisible();
  await expect(page.getByText("Decisões de custo")).toBeVisible();
});

test("operator cannot see admin navigation", async ({ page }) => {
  await login(page, "operator@loja-demo.wco.dev");
  await expect(page).toHaveURL(/\/messages/);
  await expect(page.getByRole("link", { name: "Preços" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tenant e acesso" })).toHaveCount(0);
});

test("self-service signup creates a FREE account and guides to the WhatsApp connection", async ({ page }) => {
  const email = `pw-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByRole("link", { name: "Criar conta grátis" }).click();
  await page.getByLabel("Nome da empresa").fill("Empresa Playwright");
  await page.getByLabel("Seu nome").fill("Teste");
  await page.getByLabel("E-mail de trabalho").fill(email);
  await page.getByLabel("Senha").fill("senha-forte-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL(/\/admin\/providers/);
  await expect(page.getByText("Conta criada. Próximo passo")).toBeVisible();
  await page.goto("/admin/billing");
  await expect(page.getByText("Free (atual)")).toBeVisible();
  await expect(page.getByText("0 de 1.000 eventos incluídos")).toBeVisible();
});

test("only the Embedded Signup page may load Meta's SDK", async ({ page, request }) => {
  const general = (await request.get("/login")).headers()["content-security-policy"] ?? "";
  expect(general).not.toContain("facebook");
  await login(page, "owner@loja-demo.wco.dev");
  const res = await page.goto("/admin/providers/embedded-signup");
  expect(res?.headers()["content-security-policy"]).toContain("https://connect.facebook.net");
  await expect(page.getByText("Embedded Signup não está configurado neste servidor")).toBeVisible();
});

test("history import explains where the savings came from", async ({ page }) => {
  await login(page, PLATFORM_ADMIN);
  await page.goto("/simulator");
  await page.getByRole("tab", { name: "Histórico CSV" }).click();
  await page.getByRole("button", { name: "Calcular baseline e simulação" }).click();
  await expect(page.getByText("De onde veio a economia")).toBeVisible();
  await expect(page.getByText("Atualizações substituídas pela mais recente")).toBeVisible();
  await expect(page.getByText("6 com entityId · 2 só content · 0 sem identificação")).toBeVisible();
});

test("templates can be imported from the connected account", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  await page.goto("/admin/templates");
  await page.getByRole("button", { name: "Sincronizar com a Meta" }).click();
  await expect(page.getByText(/template\(s\) importado\(s\)/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "hello_world" }).first()).toBeVisible();
});

test("the company writes its combined message in the WCO and, once Meta approves it, joining is on", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  const nav = page.getByRole("navigation", { name: "Navegação principal" }).first();
  for (const name of ["Mensagens", "Conversas e janelas", "Webhooks", "Privacidade (LGPD)", "Auditoria"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await nav.getByRole("link", { name: "Economia de juntar mensagens" }).click();
  await expect(page.getByRole("heading", { name: "Economia de juntar mensagens" })).toBeVisible();
  await expect(page.getByText("Jeito errado").first()).toBeVisible();
  await expect(page.getByText("Como conversa")).toHaveCount(0); // the conversation mode is built in: nothing to switch

  const box = page.getByLabel("Sua mensagem");
  const send = page.getByRole("button", { name: "Enviar para aprovação da Meta" });
  await box.fill("As novidades do seu pedido são: [atualizações]");
  await expect(page.getByText("Escreva algo depois de [atualizações].")).toBeVisible();
  await expect(send).toBeDisabled();

  const text = `Olá! Novidades do seu pedido: [atualizações]. Teste ${Date.now()}, qualquer dúvida responda aqui.`;
  await box.fill(text);
  await send.click();
  await expect(page.getByText("Economia ativa.")).toBeVisible(); // the mock approves at once; Meta reviews real ones
  await page.reload();
  await expect(page.getByLabel("Sua mensagem")).toHaveValue(text);
});
