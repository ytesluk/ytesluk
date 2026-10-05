import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "wco-demo-2026!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/");
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

test("savings simulator returns an estimated result", async ({ page }) => {
  await login(page, "owner@loja-demo.wco.dev");
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
  await login(page, "owner@loja-demo.wco.dev");
  await page.goto("/simulator");
  await page.getByRole("tab", { name: "Histórico CSV" }).click();
  await page.getByRole("button", { name: "Calcular baseline e simulação" }).click();
  await expect(page.getByText("De onde veio a economia")).toBeVisible();
  await expect(page.getByText("Atualizações substituídas pela mais recente")).toBeVisible();
  await expect(page.getByText("6 com entityId · 2 só content · 0 sem identificação")).toBeVisible();
});
