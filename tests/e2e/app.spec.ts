// The real interface, driven the way he uses it: open, read the design, flip
// through every view, switch topology, break an input, export every format,
// save and reopen — in both themes, with an axe pass and the fold probe.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { foldProbe, clippedElements, pageScrolls } from "../foldProbe.mjs";

const SHOTS = "tests/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function fresh(page: Page, theme = "instrument") {
  await page.goto("/");
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("planar-studio.theme", t); }, theme);
  await page.reload();
  await designed(page);
}

/** Wait until a search has finished and a design is on screen. */
async function designed(page: Page) {
  await expect(page.getByTestId("status")).toContainText("feasible", { timeout: 60_000 });
  await expect(page.getByTestId("hero-loss")).toBeVisible();
}

for (const theme of ["instrument", "drafting"]) {
  test(`default flyback design in ${theme}: every view renders, axe is clean`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await fresh(page, theme);
    await expect(page.getByTestId("verdict")).not.toContainText("fail");
    await expect(page.getByTestId("candidates").locator("button").first()).toBeVisible();
    await expect(page.locator("[data-test=viewport-3d] canvas")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${theme}-3d.png` });

    await page.getByTestId("explode").click();
    await page.getByTestId("cut").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${theme}-3d-exploded.png` });

    await page.getByTestId("view-layers").click();
    await expect(page.getByTestId("layer-drawing").locator("svg path[stroke-linecap]").first()).toBeVisible();
    await page.getByTestId("layer-2").click();
    await page.screenshot({ path: `${SHOTS}/${theme}-layers.png` });

    await page.getByTestId("view-section").click();
    await expect(page.getByTestId("section-drawing").locator("polyline")).toBeVisible();
    await page.getByTestId("view-waveforms").click();
    await expect(page.getByTestId("chart-currents").locator("polyline").first()).toBeVisible();
    await expect(page.getByTestId("chart-flux").locator("polyline")).toBeVisible();
    await page.getByTestId("view-tradeoffs").click();
    await expect(page.getByTestId("chart-by-core").locator("rect:not([height=\"0\"])").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${theme}-tradeoffs.png` });
    await page.getByTestId("view-steps").click();
    await expect(page.getByTestId("steps")).toContainText("Turns ratio");
    await page.screenshot({ path: `${SHOTS}/${theme}-steps.png` });

    await page.getByTestId("tab-checks").click();
    await expect(page.getByTestId("checks").locator("li").first()).toBeVisible();
    await page.getByTestId("tab-coverage").click();
    await expect(page.locator(".assumption-list").first()).toBeVisible();

    const axe = await new AxeBuilder({ page }).exclude("[data-test=viewport-3d]").analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    expect(await pageScrolls(page)).toEqual({ x: false, y: false });
    expect(errors).toEqual([]);
  });
}

test("every topology produces a design, and centre tap gets two secondaries", async ({ page }) => {
  await fresh(page);
  for (const t of ["forward", "llc", "fullbridge", "flyback"]) {
    await page.getByTestId(`topo-${t}`).click();
    await expect(page.getByTestId("doc-line")).toContainText(t.toUpperCase());
    await designed(page);
    await expect(page.getByTestId("verdict")).not.toContainText("fail");
    if (t === "llc") {
      await page.getByTestId("view-layers").click();
      await expect(page.locator(".layer-list")).toContainText("S2");
      await page.screenshot({ path: `${SHOTS}/llc-layers.png` });
      await page.getByTestId("view-3d").click();
    }
  }
});

test("a broken input is named, and the last design stays", async ({ page }) => {
  await fresh(page);
  const before = await page.getByTestId("doc-line").textContent();
  await page.getByTestId("f-vinMin").fill("70");
  await expect(page.getByTestId("input-errors")).toContainText("Vin min ≤ Vin nom");
  await expect(page.getByTestId("hero-loss")).toBeVisible();
  await page.getByTestId("f-vinMin").fill("36");
  await expect(page.getByTestId("input-errors")).toHaveCount(0);
  await designed(page);
  expect(await page.getByTestId("doc-line").textContent()).toBe(before);
});

test("an impossible spec explains itself", async ({ page }) => {
  await fresh(page);
  await page.getByTestId("f-iout").fill("200");
  await expect(page.getByTestId("none-feasible")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("none-feasible")).toContainText("Most common reasons");
  await page.screenshot({ path: `${SHOTS}/none-feasible.png` });
});

test("every export downloads a real file; the KiCad project passes KiCad DRC", async ({ page }, info) => {
  await fresh(page);
  const kicad = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli";
  for (const id of ["report", "kicad", "gerber", "dxf"]) {
    await page.getByTestId("export").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`export-${id}`).click()]);
    const path = info.outputPath(dl.suggestedFilename());
    await dl.saveAs(path);
    const body = readFileSync(path);
    expect(body.length).toBeGreaterThan(500);
    if (id === "report") expect(body.toString()).toContain("Design path");
    if (id === "gerber" || id === "kicad") expect(execFileSync("/usr/bin/unzip", ["-t", path]).toString()).toContain("No errors");
    if (id === "kicad") {
      try { readFileSync(kicad); } catch { continue; }
      const dir = info.outputPath("kicad");
      execFileSync("/usr/bin/unzip", ["-o", "-q", path, "-d", dir]);
      const pcb = execFileSync("/bin/sh", ["-c", `ls ${dir}/*/*.kicad_pcb`]).toString().trim();
      execFileSync(kicad, ["pcb", "drc", "--format", "json", "-o", `${dir}/drc.json`, pcb], { stdio: "pipe" });
      const rep = JSON.parse(readFileSync(`${dir}/drc.json`, "utf8"));
      expect(rep.violations.map((v: { type: string }) => v.type)).toEqual([]);
      expect(rep.unconnected_items.length).toBe(0);
    }
  }
});

test("save, change, and open the saved design again", async ({ page }, info) => {
  await fresh(page);
  const before = await page.getByTestId("doc-line").textContent();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const path = info.outputPath("design.planar.json");
  await dl.saveAs(path);
  await page.getByTestId("topo-forward").click();
  await designed(page);
  await page.locator("input[type=file]").setInputFiles(path);
  await designed(page);
  await expect(page.getByTestId("doc-line")).toHaveText(before!);
  // A file that is not a design is refused with the reason, and nothing changes.
  await page.locator("input[type=file]").setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("{\"x\":1}") });
  await expect(page.getByRole("alert")).toContainText("not a Planar Studio design");
  await expect(page.getByTestId("doc-line")).toHaveText(before!);
});

test("keyboard: views, explode, candidates", async ({ page }) => {
  await fresh(page);
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.keyboard.press("2");
  await expect(page.getByTestId("view-layers")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("1");
  await page.keyboard.press("e");
  await expect(page.getByTestId("explode")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("cand-1")).toHaveClass(/active/);
});

test("fold probe: every named control is on screen at laptop sizes, nothing clipped", async ({ page }) => {
  const r = await foldProbe(page, {
    url: "/",
    cases: [{
      name: "main",
      load: async (p: Page) => { await designed(p); },
      must: ["[data-test=topo-flyback]", "[data-test=topo-fullbridge]", "[data-test=export]", "[data-test=view-steps]",
        "[data-test=cand-0]", "[data-test=hero-loss]", "[data-test=explode]", "[data-test=fit]", "[data-test=f-vout]", "[data-test=tab-coverage]"],
    }],
  });
  expect(r.failures).toEqual([]);
  for (const vp of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    expect(await clippedElements(page, [".toolbar .segmented button", ".view-tools button", ".app-header button", ".inspector-tabs button"])).toEqual([]);
  }
  await page.screenshot({ path: `${SHOTS}/fold-1440.png` });
});
