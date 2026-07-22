import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:4321";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const routes = [
  ["home", "/", "Memory Systems Daily"],
  ["roadmap", "/roadmap", "전체 학습 과정"],
  ["automation", "/automation", "매일 08:30"],
  ["post", "/posts/llm-next-token", "다음 Token을 예측"],
];
const viewports = [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
];

await mkdir("artifacts/screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const failures = [];

for (const [viewportName, viewport] of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const [name, route, expectedText] of routes) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    if (!response?.ok()) failures.push(`${viewportName}/${name}: HTTP ${response?.status()}`);

    const content = await page.locator("body").innerText();
    if (!content.includes(expectedText)) failures.push(`${viewportName}/${name}: missing ${expectedText}`);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
    }));
    if (metrics.scrollWidth > metrics.clientWidth + 1) {
      failures.push(`${viewportName}/${name}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
    }
    if (metrics.brokenImages) failures.push(`${viewportName}/${name}: ${metrics.brokenImages} broken images`);

    await page.screenshot({ path: `artifacts/screenshots/${viewportName}-${name}.png`, fullPage: true });
  }

  if (consoleErrors.length) failures.push(`${viewportName}: console errors: ${consoleErrors.join(" | ")}`);
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Visual checks passed: ${routes.length} pages x ${viewports.length} viewports`);
