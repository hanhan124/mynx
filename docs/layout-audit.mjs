// layout-audit.mjs — headless CDP 布局审计（本地工具，不提交）
// 用途：在多个视口下检查各功能页是否存在横向溢出 / 内容裁切 / 交互按钮不可见。
// 仅读取 DOM 几何，不修改应用，不记录用户数据。
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:4173";
const CDP_PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "mynx-layout-audit-"));

const routes = [
  ["home", "/"],
  ["image", "/image"],
  ["qpcr", "/qpcr"],
  ["rnaseq", "/rnaseq"],
  ["charts", "/charts"],
  ["settings", "/settings"],
];
// 视口：默认窗口内容区近似、最大化近似、小窗口、用户确认尺寸
const viewports = [
  { name: "default-1280x800", w: 1280, h: 800 },
  { name: "max-1440x900", w: 1440, h: 900 },
  { name: "old-960x540", w: 960, h: 540 },
  { name: "small-420x720", w: 420, h: 720 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpUrl() {
  return `http://127.0.0.1:${CDP_PORT}`;
}

async function getJson(path) {
  const res = await fetch(cdpUrl() + path);
  return res.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

const edge = spawn(EDGE, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

let ws;
try {
  // 等 CDP 就绪
  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await getJson("/json/list");
      if (targets.length) break;
    } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const results = [];
  for (const vp of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const [name, route] of routes) {
      await cdp.send("Page.navigate", { url: BASE + "/#" + route });
      await sleep(700);
      const data = await cdp.evaluate(`(() => {
        const de = document.documentElement;
        const vw = window.innerWidth, vh = window.innerHeight;
        const out = {
          vw, vh,
          scrollW: de.scrollWidth, clientW: de.clientWidth,
          scrollH: de.scrollHeight, clientH: de.clientHeight,
          horizontalOverflow: de.scrollWidth - de.clientWidth,
          // 收集可见且超出视口右边界的交互元素
          overflowRight: [],
          clippedButtons: [],
          mainScrollable: false,
          geometry: {},
        };
        const main = document.querySelector('main');
        if (main) {
          out.mainScrollable = main.scrollHeight > main.clientHeight + 2;
          const mr = main.getBoundingClientRect();
          out.geometry.main = { h: Math.round(mr.height), scrollH: main.scrollHeight, clientH: main.clientHeight, bottom: Math.round(mr.bottom) };
        }
        const body = document.body;
        out.geometry.body = { scrollH: body.scrollHeight, clientH: body.clientHeight };
        const shell = document.querySelector('.h-screen');
        if (shell) {
          const sr = shell.getBoundingClientRect();
          out.geometry.shell = { h: Math.round(sr.height), scrollH: shell.scrollHeight, clientH: shell.clientHeight };
        }
        const els = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'));
        for (const el of els) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
          const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 40);
          if (r.right > vw + 1) out.overflowRight.push({ label, right: Math.round(r.right), vw });
          // 按钮顶部在视口外（需滚动才能看到）
          if (r.top > vh + 1) out.clippedButtons.push({ label, top: Math.round(r.top), vh });
        }
        return out;
      })()`);
      results.push({ viewport: vp.name, route: name, ...data });

      // 截图（仅默认与最大化两个视口，便于目视核对）
      if (vp.name === "default-1280x800" || vp.name === "old-960x540") {
        const shotDir = join(process.cwd(), "docs", "audit-shots");
        mkdirSync(shotDir, { recursive: true });
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shotDir, `${vp.name}-${name}.png`), Buffer.from(shot.data, "base64"));
      }
    }
  }
  writeFileSync(
    join(process.cwd(), "docs", "layout-audit-results.json"),
    JSON.stringify(results, null, 2),
  );
  // 摘要
  for (const r of results) {
    const flag = r.horizontalOverflow > 1 ? `H-OVERFLOW=${r.horizontalOverflow}` : "ok";
    console.log(
      `${r.viewport.padEnd(16)} ${r.route.padEnd(9)} ${flag.padEnd(18)} ` +
        `scrollH=${r.scrollH}/${r.clientH} mainScroll=${r.mainScrollable} ` +
        `overflowRight=${r.overflowRight.length} clippedBtn=${r.clippedButtons.length}`,
    );
  }
} catch (e) {
  console.error("AUDIT FAILED:", e.message);
  process.exitCode = 1;
} finally {
  if (ws) ws.close();
  edge.kill("SIGTERM");
}
