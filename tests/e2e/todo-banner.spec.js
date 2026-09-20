const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

// Regression test for the dashboard to-do list: a Checker should see their
// pending Standing Instruction reviews the moment they log in, broken down
// per deal, not just a per-tile badge they have to notice on their own.
test("checker sees a to-do banner with per-deal pending Standing Instruction counts", async ({ page }) => {
  await loginAs(page, "Chen");

  const banner = page.locator(".todo-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Standing Instruction");
  await expect(banner).toContainText("awaiting your review");

  const dealItem = banner.locator(".todo-banner-item", { hasText: "BangaloreMetro26" });
  await expect(dealItem).toBeVisible();
  await expect(dealItem.locator(".todo-banner-item-count")).toBeVisible();

  await dealItem.click();
  await page.waitForURL(/\/deals\/\d+$/);
});

// A role with no pending task type (today, anyone but a Checker) should
// see no banner at all — pending_task_count is 0 for them server-side.
test("non-checker role sees no to-do banner", async ({ page }) => {
  await loginAs(page, "Dana");
  await expect(page.locator(".todo-banner")).toHaveCount(0);
});
