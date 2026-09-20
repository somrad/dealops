const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

// Regression test for the /describe formatting work: describe's reply
// should render as real table rows (not a flat text blob), include the
// document-derived Borrower/Lenders rows, and show the deal's member
// avatars underneath it.
test("describe command renders a table with borrower/lender rows and member avatars", async ({ page }) => {
  await loginAs(page, "Dana");
  await page.click("text=BangaloreMetro26");
  await page.waitForSelector(".chat-box");

  const input = page.locator('input[placeholder*="Type a message"]');
  await input.fill("@BangaloreMetro26_agent describe");
  await input.press("Enter");

  const productRow = page.locator(".bot-table-row", { hasText: "Product" }).last();
  await expect(productRow).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".bot-table-row", { hasText: "Borrower" }).last()).toBeVisible();
  await expect(page.locator(".bot-table-row", { hasText: "Lenders" }).last()).toBeVisible();
  await expect(page.locator(".bot-message-members").last()).toBeVisible();
});
