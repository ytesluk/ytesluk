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

test("a company that connects its WhatsApp gets the combined message ready, then connects its system with a key", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Criar conta grátis" }).click();
  await page.getByLabel("Nome da empresa").fill("Loja Junta Playwright");
  await page.getByLabel("Seu nome").fill("Teste");
  await page.getByLabel("E-mail de trabalho").fill(`pw-junta-${Date.now()}@example.test`);
  await page.getByLabel("Senha").fill("senha-forte-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL(/\/admin\/providers/);

  const nav = page.getByRole("navigation", { name: "Navegação principal" }).first();
  for (const name of ["Mensagens", "Conversas e janelas", "Webhooks", "Privacidade (LGPD)", "Auditoria", "Templates", "Tenant e acesso"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await expect(nav.getByRole("link", { name: /juntar|economias/i })).toHaveCount(0);

  await page.locator("summary", { hasText: "Conecte agora" }).click();
  await page.getByRole("button", { name: "Usar conta de teste" }).click();
  await expect(page.getByText("Conta de teste conectada.")).toBeVisible();

  // Step 2 on the same page: a key for the company's system, shown once, that really sends through the WCO.
  await expect(page.getByText("Como a sua empresa manda os avisos?")).toBeVisible();
  await page.getByRole("button", { name: /Tenho um sistema próprio/ }).click();
  await expect(page.getByText("Conecte o seu sistema")).toBeVisible();
  await page.getByRole("button", { name: "Gerar chave" }).click();
  const key = (await page.locator("code", { hasText: /^wco_/ }).innerText()).trim();
  expect(key).toMatch(/^wco_/);
  const sent = await request.post(`${process.env.API_URL ?? "http://localhost:4000"}/api/v1/messages/intents`, {
    headers: { "X-API-Key": key },
    data: { customer: "+5511950008001", eventType: "order.status", entityId: "PED-E2E-1", data: { orderId: "1", statusLabel: "pedido enviado" }, consent: { optIn: true, source: "e2e" } },
  });
  expect(sent.status()).toBeLessThan(300);
  await page.reload();
  await expect(page.getByText("Seu sistema já envia pelo WCO")).toBeVisible();

  await page.goto("/admin/templates");
  await expect(page.getByRole("cell", { name: /^wco_juntar_/ }).first()).toBeVisible(); // the mock approves at once; Meta reviews real ones
});

test("a company without a system sends a campaign from the WCO itself", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
  await page.goto("/admin/providers");
  await page.getByRole("button", { name: /Uso uma plataforma ou não tenho sistema/ }).click();
  await page.getByRole("link", { name: /Ir para Enviar mensagens/ }).click();
  await expect(page.getByRole("heading", { name: "Enviar mensagens" })).toBeVisible();

  // The company picks by the text it reads, not by the template's technical name; codes are not offered.
  await expect(page.getByRole("radio", { name: /otp_code/ })).toHaveCount(0);
  await page.getByRole("radio", { name: /order_status_update/ }).click();
  await page.getByLabel("Número do pedido").fill("4521");
  await page.getByLabel("Situação do pedido").fill("pedido enviado");
  await page.getByLabel("2. Para quem").fill("(11) 95000-9101\n11 95000-9102\n(11) 95000-9101\nnão é número");
  await expect(page.getByText("1 linha não parece número")).toBeVisible();
  const send = page.getByRole("button", { name: "Enviar para 3 clientes" });
  await expect(send).toBeDisabled(); // consent not confirmed yet
  await page.getByText("Essas pessoas autorizaram receber mensagens").click();
  await send.click();
  await expect(page.getByText("2 mensagens a caminho.")).toBeVisible();
  await expect(page.getByText(/repetido/)).toBeVisible();
});
