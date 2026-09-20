// One-click demo login buttons are labeled "{Name} — {Role}" on the login
// page (src/frontend/src/pages/LoginPage.jsx) — matching on the first name
// is enough since all six demo accounts have distinct first names.
async function loginAs(page, firstName) {
  await page.goto("/");
  await page.click(`button:has-text("${firstName}")`);
  await page.waitForURL(/\/deals$/);
}

module.exports = { loginAs };
