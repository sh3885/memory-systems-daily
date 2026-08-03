import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const adminPassword = process.env.VISUAL_ADMIN_PASSWORD ?? "";
const screenshotEvery = process.env.VISUAL_SCREENSHOT_ALL === "1";

const viewports = [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
];

// Pages whose main content sits behind the admin gate.
const isAdminRoute = (route) => route.startsWith("/admin");

async function collectRoutes(dir = distDir, prefix = "/") {
  const routes = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error("dist/ was not found. Run `astro build` before the visual check.");
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(...await collectRoutes(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "index.html") {
      routes.push(prefix);
    } else if (entry.name.endsWith(".html")) {
      routes.push(`${prefix}${entry.name.replace(/\.html$/, "")}/`);
    }
  }
  return routes.sort();
}

async function waitForServer(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // Server is not accepting connections yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

async function startPreviewServer(port) {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules/astro/bin/astro.mjs"), "preview", "--port", String(port)],
    { cwd: root, stdio: "ignore" },
  );
  const ready = await waitForServer(`http://localhost:${port}/`);
  if (!ready) {
    child.kill();
    throw new Error(`Preview server did not become ready on port ${port}.`);
  }
  return child;
}

const routes = await collectRoutes();
if (!routes.length) throw new Error("No routes were found in dist/.");

let baseUrl = process.env.VISUAL_BASE_URL ?? "";
let previewServer = null;

if (baseUrl) {
  if (!await waitForServer(`${baseUrl}/`, 4)) {
    throw new Error(`VISUAL_BASE_URL is not reachable: ${baseUrl}`);
  }
} else {
  // Prefer the built output: no HMR socket, and it is what actually gets deployed.
  previewServer = await startPreviewServer(4325);
  baseUrl = "http://localhost:4325";
}

await mkdir(join(root, "artifacts/screenshots"), { recursive: true });
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const failures = [];

// Representative pages worth an image; every route is still functionally checked.
const screenshotRoutes = new Set(
  ["/", "/llm/", "/memory/", "/system/", "/tags/", "/admin/", "/admin/new/", "/admin/settings/"]
    .filter((route) => routes.includes(route)),
);

console.log(`Checking ${routes.length} route(s) at ${baseUrl}`);

try {
  for (const [viewportName, viewport] of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    for (const route of routes) {
      const label = `${viewportName}${route}`;
      const consoleErrors = [];
      const badResponses = [];
      const onConsole = (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      };
      const onPageError = (error) => consoleErrors.push(`pageerror: ${error.message}`);
      const onResponse = (response) => {
        const url = response.url();
        if (response.status() >= 400 && !url.includes("/api/")) {
          badResponses.push(`${response.status()} ${url}`);
        }
      };
      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("response", onResponse);

      try {
        // `domcontentloaded` avoids stalling on the dev server's long-lived HMR socket.
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
        if (!response?.ok()) failures.push(`${label}: HTTP ${response?.status()}`);
        await page.waitForLoadState("load").catch(() => {});

        if (isAdminRoute(route) && adminPassword) {
          // The gate stays unlocked for the rest of the session, so only fill it when shown.
          const field = page.locator('input[name="entryPassword"]');
          if (await field.isVisible().catch(() => false)) {
            await field.fill(adminPassword);
            await page.locator('[data-admin-password-form] button[type="submit"]').click();
          }
          await page.locator("[data-admin-content]:not([hidden])").waitFor({ timeout: 8000 })
            .catch(() => failures.push(`${label}: admin content stayed hidden after unlock`));
        }

        const text = (await page.locator("body").innerText()).trim();
        if (text.length < 40) failures.push(`${label}: page body looks empty (${text.length} chars)`);
        if (!await page.locator("h1").count()) failures.push(`${label}: no h1 heading`);

        const readMetrics = () => page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
          emptyLinks: [...document.querySelectorAll("a[href]")].filter((link) => {
            const href = link.getAttribute("href");
            return !href || href === "#" || href === "undefined" || href.includes("undefined");
          }).length,
        }));
        // A meta-refresh stub can tear down the context mid-read; retry once after it settles.
        const metrics = await readMetrics().catch(async () => {
          await page.waitForLoadState("load").catch(() => {});
          return readMetrics();
        });
        if (metrics.scrollWidth > metrics.clientWidth + 1) {
          failures.push(`${label}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
        }
        if (metrics.brokenImages) failures.push(`${label}: ${metrics.brokenImages} broken image(s)`);
        if (metrics.emptyLinks) failures.push(`${label}: ${metrics.emptyLinks} broken link href(s)`);
        if (badResponses.length) failures.push(`${label}: failed request(s) ${badResponses.join(", ")}`);
        if (consoleErrors.length) failures.push(`${label}: console errors: ${consoleErrors.join(" | ")}`);

        if (screenshotEvery || screenshotRoutes.has(route)) {
          const name = route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/\//g, "-");
          await page.screenshot({ path: join(root, `artifacts/screenshots/${viewportName}-${name}.png`), fullPage: true });
        }
      } catch (error) {
        failures.push(`${label}: ${error.message}`);
      } finally {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("response", onResponse);
      }
    }

    console.log(`  ${viewportName}: ${routes.length} route(s) checked`);
    await context.close();
  }
} finally {
  await browser.close();
  previewServer?.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s) found:`);
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Visual checks passed: ${routes.length} routes x ${viewports.length} viewports`);
if (!adminPassword) {
  console.log("Note: set VISUAL_ADMIN_PASSWORD to also verify content behind the admin gate.");
}
