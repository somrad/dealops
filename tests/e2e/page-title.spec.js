const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

// The browser tab title should always identify who's logged in and as what
// role — several demo accounts are often open in different tabs at once
// during a demo, and a shared "DealOps" / a deal's own title looked
// identical across all of them.
test("page title shows DealOps - username - role and doesn't change inside a Deal Room", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("DealOps");

  await loginAs(page, "Chen");
  await expect(page).toHaveTitle("DealOps - chen - Checker");

  await page.click("text=BangaloreMetro26");
  await page.waitForSelector(".deal-top-bar");
  await expect(page).toHaveTitle("DealOps - chen - Checker");
});
