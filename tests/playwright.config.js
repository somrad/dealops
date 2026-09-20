const { defineConfig } = require("@playwright/test");

// These are real end-to-end tests against the actual running stack (backend
// + ai_api + frontend), not unit tests — see README.md for prerequisites.
// Not parallel: tests share real backend state (an existing deal's chat,
// SSIs, etc.), same as how this app has been manually verified all along.
module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
