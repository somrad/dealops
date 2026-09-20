const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

test("one-click demo login lands on the deals dashboard", async ({ page }) => {
  await loginAs(page, "Dana");
  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.locator(".navbar-brand")).toBeVisible();
  await expect(page.locator(".profile-menu-wrapper")).toBeVisible();
});
