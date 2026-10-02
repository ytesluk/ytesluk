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
