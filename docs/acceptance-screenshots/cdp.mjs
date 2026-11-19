/* CDP driver for the Mynx WebView2 (dev-only audit harness).
   Usage:
     node cdp.mjs eval "<js expression>"     evaluate JS (awaits promises)
     node cdp.mjs shot <out.png>             capture full-page screenshot
     node cdp.mjs viewport <w> <h>           emulate viewport size
     node cdp.mjs resetviewport              clear viewport emulation
     node cdp.mjs info                       basic page info
*/
const PORT = 9223;

async function getTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("localhost:1420"));
  if (!page) throw new Error("Mynx page target not found: " + JSON.stringify(list.map(t => t.url)));
  return page;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); },
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
    ws.onerror = (e) => reject(new Error("ws error"));
  });
}

const [,, cmd, ...args] = process.argv;
const target = await getTarget();
const cdp = await connect(target.webSocketDebuggerUrl);

if (cmd === "eval") {
  const res = await cdp.send("Runtime.evaluate", {
    expression: args[0],
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails, null, 1));
    process.exit(1);
  }
  console.log(JSON.stringify(res.result?.value, null, 1));
} else if (cmd === "shot") {
  const res = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args[0], Buffer.from(res.data, "base64"));
  console.log("saved", args[0]);
} else if (cmd === "viewport") {
  const metrics = await cdp.send("Page.getLayoutMetrics");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: parseInt(args[0]), height: parseInt(args[1]),
    deviceScaleFactor: 0, mobile: false,
  });
  console.log("viewport set", args[0], args[1]);
} else if (cmd === "resetviewport") {
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  console.log("viewport reset");
} else if (cmd === "info") {
  const res = await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify({url: location.href, title: document.title, innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio})",
    returnByValue: true,
  });
  console.log(res.result.value);
} else {
  console.error("unknown cmd", cmd);
  process.exit(1);
}
cdp.close();
