const { test, expect } = require("@playwright/test");
const { loginAs } = require("../helpers/auth");

// Regression test for mirroring a pared-down Deal Map onto every dashboard
// tile: Product / Borrower / Lenders rows (Status is the card header pill;
// Members/Messages/Standing-instructions counts were dropped as not
// needed here), right-aligned stacked party lists, and a row of member
// avatars pinned to the bottom — in both the card-grid and list layouts.
test("dashboard tile shows the pared-down Deal Map rows and bottom-aligned avatars", async ({ page }) => {
  await loginAs(page, "Dana");

  const card = page.locator(".deal-card-v", { hasText: "BangaloreMetro26" });
  await expect(card).toBeVisible();

  for (const label of ["Product", "Borrower", "Lenders"]) {
    await expect(card.locator(".sidebar-row", { hasText: label })).toBeVisible();
  }
  // Rows removed per the founder's ask — must not reappear.
  for (const label of ["Status", "Members", "Messages so far", "Standing instructions"]) {
    await expect(card.locator(".sidebar-row", { hasText: label })).toHaveCount(0);
  }
  await expect(card.locator(".deal-map-mini-avatars > div").first()).toBeVisible();

  // Same structure holds in list view, not just the default card grid.
  await page.click('button[title="List view"]');
  const bar = page.locator(".deal-bar", { hasText: "BangaloreMetro26" });
  await expect(bar.locator(".sidebar-row", { hasText: "Borrower" })).toBeVisible();
  await expect(bar.locator(".sidebar-row", { hasText: "Lenders" })).toBeVisible();
});
