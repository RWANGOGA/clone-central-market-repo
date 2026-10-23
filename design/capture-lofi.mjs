/**
 * Exports the low-fi wireframes as PNGs, without anyone having to open the file
 * and press a button.
 *
 * design/lofi/wireframes.html draws all 33 screens as 393x852 `.canvas` frames
 * in one document. Each frame is captured where it lies, at 2x, so the result is
 * a 786x1704 image that drops onto a Figma page at phone size and stays sharp —
 * the same dimensions the design/hifi captures use.
 *
 *   node design/capture-lofi.mjs
 *
 * Outputs, in design/lofi/png/:
 *   WF-01.png … WF-33.png     one file per screen, named by its frame id
 *   sheet.png                 the whole document, at 1x
 *
 * The page's own html2canvas buttons are not used: a 12,000-pixel-tall canvas is
 * beyond what a browser canvas reliably holds, and a screenshot taken by the
 * browser it is rendered in has no such limit.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Not 9335: that is capture.mjs's port, and two runs attaching to one browser
// stall as soon as the first one closes.
const PORT = 9336;
const HTML = path.resolve('design/lofi/wireframes.html');
const OUT = path.resolve('design/lofi/png');
const VIEWPORT = { width: 1440, height: 1000 };
const FRAME_SIZE = { width: 393, height: 852 };
const COMMAND_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome = null;

async function startChrome() {
  const busy = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    .then((res) => res.ok)
    .catch(() => false);
  if (busy) {
    throw new Error(`Port ${PORT} is already serving Chrome — pkill -f "remote-debugging-port=${PORT}"`);
  }
  fs.rmSync('/tmp/mk-cdp-lofi', { recursive: true, force: true });
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/mk-cdp-lofi',
      '--no-first-run',
      '--disable-background-networking',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  chrome = child;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* still starting */
    }
    await sleep(500);
  }
  throw new Error('Chrome did not open a DevTools port');
}

/** A minimal DevTools protocol client: send a command, await its id. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed')));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const wait = msg.id && pending.get(msg.id);
    if (!wait) return;
    pending.delete(msg.id);
    if (msg.error) wait.reject(new Error(`${msg.error.message} (${msg.error.code})`));
    else wait.resolve(msg.result);
  });
  return {
    ready: open,
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${COMMAND_TIMEOUT_MS / 1000}s`));
        }, COMMAND_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => ws.close(),
  };
}

/** Runs an expression in the page and returns the value, JSON-decoded. */
async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (res.exceptionDetails) {
    throw new Error(`page threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  return res.result.value;
}

async function main() {
  if (!fs.existsSync(HTML)) throw new Error(`not found: ${HTML} — run this from the repository root`);
  fs.mkdirSync(OUT, { recursive: true });

  const wsUrl = await startChrome();
  const cdp = connect(wsUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send('Page.navigate', { url: `file://${HTML}` }, sessionId);

    // The frames are built by an inline script while the document parses, so the
    // page is ready when the sections exist — no network involved.
    let count = 0;
    for (let i = 0; i < 40; i += 1) {
      count = await evaluate(cdp, sessionId, 'document.querySelectorAll("section.frame").length');
      if (count > 0) break;
      await sleep(250);
    }
    if (count === 0) throw new Error('the wireframe document rendered no frames — check the HTML for a script error');

    // The sticky export toolbar is for a human in a browser. In a capture it
    // would sit on top of the first row of frames.
    await evaluate(
      cdp,
      sessionId,
      `(() => { const s = document.createElement('style');
        s.textContent = '.toolbar { display: none !important; }';
        document.head.appendChild(s);
        return document.querySelectorAll('section.frame').length; })()`,
    );
    await sleep(300);

    const frames = await evaluate(
      cdp,
      sessionId,
      `JSON.stringify([...document.querySelectorAll('section.frame')].map((f) => {
        const c = f.querySelector('.canvas').getBoundingClientRect();
        return {
          id: f.querySelector('h2 em').textContent.trim().split(' ')[0],
          x: c.left + window.scrollX,
          y: c.top + window.scrollY,
          width: c.width,
          height: c.height,
        };
      }))`,
    ).then(JSON.parse);

    const sheet = await evaluate(
      cdp,
      sessionId,
      `JSON.stringify({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`,
    ).then(JSON.parse);

    console.log(`${frames.length} frames, document ${sheet.width}x${sheet.height}`);

    // Only once the page has actually rendered: a set that keeps a screen from
    // an earlier run is worse than one missing a screen, because the stale frame
    // looks like it was checked. Scoped to what this script writes.
    for (const stale of fs.readdirSync(OUT)) {
      if (/^(WF-\d+|sheet)\.png$/.test(stale)) fs.rmSync(path.join(OUT, stale));
    }

    const write = (file, base64) => {
      const png = Buffer.from(base64, 'base64');
      fs.writeFileSync(path.join(OUT, file), png);
      const kb = Math.round(png.length / 1024);
      console.log(`  ${file.padEnd(14)} ${String(kb).padStart(6)} KB${kb < 8 ? '  <-- suspiciously small, probably blank' : ''}`);
      return png.length;
    };

    let wrongSize = 0;
    for (const frame of frames) {
      if (Math.round(frame.width) !== FRAME_SIZE.width || Math.round(frame.height) !== FRAME_SIZE.height) {
        console.log(`  ! ${frame.id} is ${Math.round(frame.width)}x${Math.round(frame.height)}, not 393x852`);
        wrongSize += 1;
      }
      const { data } = await cdp.send(
        'Page.captureScreenshot',
        {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: frame.x, y: frame.y, width: frame.width, height: frame.height, scale: 2 },
        },
        sessionId,
      );
      write(`${frame.id}.png`, data);
    }

    // The overview at 1x: at 2x this document is tens of millions of pixels.
    const { data: sheetData } = await cdp.send(
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: sheet.width, height: Math.min(sheet.height, 16000), scale: 1 },
      },
      sessionId,
    );
    write('sheet.png', sheetData);

    if (wrongSize) console.log(`\n${wrongSize} frame(s) were not the expected size.`);
    console.log(`\nWrote ${frames.length + 1} files to ${OUT}`);
  } finally {
    try {
      await cdp.send('Browser.close');
    } catch {
      /* closing the socket mid-response is expected */
    }
    cdp.close();
    chrome?.kill();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  chrome?.kill();
  process.exit(1);
});
