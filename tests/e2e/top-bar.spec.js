const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

// Regression test for the merged top bar: on the Deal Room page, the global
// Navbar should NOT render at all — its brand and profile menu move into
// the deal room's own top bar instead (see App.jsx's hideNavbar prop).
test("deal room top bar merges brand + deal info, clusters chat/burger/profile", async ({ page }) => {
  await loginAs(page, "Dana");
  await page.click("text=BangaloreMetro26");
  await page.waitForSelector(".deal-top-bar");

  await expect(page.locator("header.navbar")).toHaveCount(0);

  await expect(page.locator(".deal-top-bar-main .navbar-brand")).toBeVisible();
  await expect(page.locator(".deal-top-bar-main h1")).toHaveText("BangaloreMetro26");

  await expect(page.locator(".deal-top-bar-actions .chat-toggle-btn")).toBeVisible();
  await expect(page.locator(".deal-top-bar-actions .drawer-trigger")).toBeVisible();
  await expect(page.locator(".deal-top-bar-actions .profile-menu-wrapper")).toBeVisible();
});
