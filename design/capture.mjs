/**
 * Screenshots every screen of the running Mu Katale app at phone size, so the
 * hi-fi Figma prototype is the real system rather than a drawing of it.
 *
 * Chrome is driven over the DevTools protocol at 393x852 with a 2x device
 * scale factor, which is the width the components are laid out for. Screens
 * that need state (a filled basket, a shipped order, the staff console) are
 * put into that state first, through the same API the app itself uses.
 *
 *   node design/capture.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const APP = 'http://localhost:3000';
const API = `${APP}/api`;
const OUT = path.resolve('design/hifi');
const WIDTH = 393;
const HEIGHT = 852;
// A command that never comes back means the browser has stopped answering, so
// the run is failed rather than left hanging. Cold API routes inside a page
// evaluate can legitimately take tens of seconds, hence the generous budget.
const COMMAND_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The browser this run opened, kept so a failing run can still shut it down. */
let chromeChild = null;

/** Reads the seeded dev credentials out of api/.env.local without printing them. */
function envValue(name) {
  const file = fs.readFileSync(path.resolve('api/.env.local'), 'utf8');
  const line = file.split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}

async function startChrome() {
  // A second capture on the same port attaches to a browser it does not own and
  // stalls as soon as the first one closes, so refuse up front instead.
  const alreadyUp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    .then((res) => res.ok)
    .catch(() => false);
  if (alreadyUp) {
    throw new Error(
      `Port ${PORT} is already serving Chrome. Stop the other run first: pgrep -fl capture.mjs`,
    );
  }
  // A clean profile each run, so localStorage cannot carry a cart id over from
  // an earlier capture and point at somebody else's basket. The delete is
  // retried because a Chrome from a previous, failed run can still be holding
  // files open.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync('/tmp/mk-cdp-design', { recursive: true, force: true });
      break;
    } catch {
      await sleep(1000);
    }
  }
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/mk-cdp-design',
      '--no-first-run',
      '--disable-background-networking',
      '--window-size=393,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return { child, wsUrl: (await res.json()).webSocketDebuggerUrl };
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  throw new Error('Chrome did not open a debugging port. Is another instance holding 9335?');
}

/**
 * Smallest useful DevTools client: one socket to the browser, one session per
 * tab, promises resolved by message id.
 */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const settle = pending.get(msg.id);
      pending.delete(msg.id);
      if (!settle) return;
      if (msg.error) settle.reject(new Error(`${msg.method}: ${msg.error.message}`));
      else settle.resolve(msg.result);
    }
  };

  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error('WebSocket to Chrome failed'));
    ws.onopen = () =>
      resolve({
        ws,
        send(method, params = {}, sessionId) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
          return new Promise((res, rej) => {
            // A Chrome that was suspended mid capture keeps the socket open but
            // stops answering commands, which hung an overnight run in silence.
            // Every command has to come back within the budget or the run fails
            // loudly instead of stalling.
            const timer = setTimeout(() => {
              pending.delete(mid);
              rej(new Error(`${method} did not answer in ${COMMAND_TIMEOUT_MS / 1000}s — is another capture using this Chrome?`));
            }, COMMAND_TIMEOUT_MS);
            pending.set(mid, {
              resolve: (value) => {
                clearTimeout(timer);
                res(value);
              },
              reject: (err) => {
                clearTimeout(timer);
                rej(err);
              },
            });
          });
        },
      });
  });
}

class Screen {
  constructor(cdp, name) {
    this.cdp = cdp;
    this.name = name;
  }

  async open() {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    this.targetId = targetId;
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    for (const [method, params] of [
      ['Page.enable', {}],
      ['Runtime.enable', {}],
      ['Network.enable', {}],
      ['Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true }],
    ]) {
      await this.cdp.send(method, params, this.sessionId);
    }
  }

  async cookie(setCookieHeader) {
    if (!setCookieHeader) return;
    const [pair] = setCookieHeader.split(';');
    const [name, value] = pair.split('=');
    await this.cdp.send(
      'Network.setCookie',
      { name, value, domain: 'localhost', path: '/', url: APP, httpOnly: /HttpOnly/i.test(setCookieHeader) },
      this.sessionId,
    );
  }

  async go(url, waitMs = 2600) {
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await sleep(waitMs);
  }

  /**
   * Waits until the page contains the text, because the API is compiled on
   * demand in development and a cold route can take ten seconds to answer.
   */
  async waitForText(needle, timeoutMs = 45000) {
    const started = Date.now();
    while (Date.now() < started + timeoutMs) {
      const found = await this.js(`document.body.innerText.includes(${JSON.stringify(needle)})`);
      if (found) return true;
      await sleep(1000);
    }
    return false;
  }

  /** Waits for a placeholder such as "Loading" to disappear. */
  async waitForAbsent(needle, timeoutMs = 25000) {
    const started = Date.now();
    while (Date.now() < started + timeoutMs) {
      const found = await this.js(`document.body.innerText.includes(${JSON.stringify(needle)})`);
      if (!found) return true;
      await sleep(900);
    }
    return false;
  }

  /**
   * Waits for a freshly opened panel to finish its request. Watching for the
   * spinner to disappear is not enough on its own: in the moment after a tab is
   * clicked the previous panel is still on screen and already loaded, so the
   * check passes at once and the picture catches a spinner instead of the data.
   * Waiting for the spinner to appear first gives the second wait something to
   * mean, and a warm route that skips past it just costs the short budget.
   */
  async settle(spinner = 'Loading', timeoutMs = 25000) {
    await sleep(150);
    await this.waitForText(spinner, 2500);
    const done = await this.waitForAbsent(spinner, timeoutMs);
    await sleep(900);
    return done;
  }

  /** Runs JS in the page and returns the value. */
  async js(expression) {
    const res = await this.cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      this.sessionId,
    );
    if (res.exceptionDetails) throw new Error(`${this.name}: ${res.exceptionDetails.exception?.description}`);
    return res.result.value;
  }

  clickText(pattern) {
    return this.js(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const hit = [...document.querySelectorAll('button, a, [role="button"], input[type=submit]')]
        .find((el) => re.test((el.textContent || el.value || '').trim()));
      if (!hit) return false;
      hit.click();
      return true;
    })()`);
  }

  /**
   * The pages scroll inside their own container rather than the document, so
   * the tallest scrollable element is the one that means it.
   */
  scrollBy(px) {
    return this.js(`(() => {
      const boxes = [document.scrollingElement, ...document.querySelectorAll('*')]
        .filter((el) => el && el.scrollHeight > el.clientHeight + 40);
      const tallest = boxes.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!tallest) return 'no scrollable element';
      tallest.scrollTop += ${px};
      return tallest.className.slice(0, 40);
    })()`);
  }

  async type(selector, value) {
    return this.js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  async shoot(file) {
    // A frame that compresses to almost nothing is a blank one: the surface can
    // come back empty when Chrome is asked to capture while it is repainting.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.sessionId);
      const png = Buffer.from(data, 'base64');
      if (png.length > 15_000 || attempt === 3) {
        fs.writeFileSync(path.join(OUT, file), png);
        console.log(`  wrote ${file}${png.length > 15_000 ? '' : ` (only ${(png.length / 1024) | 0} KB, probably blank)`}`);
        if (png.length <= 15_000) {
          // Says whether the page really is empty or only the capture is.
          const state = await this.js(`JSON.stringify({chars: document.body.innerText.length, head: document.body.innerText.slice(0, 60)})`);
          console.log(`    page says: ${state}`);
        }
        return;
      }
      await sleep(1500);
    }
  }

  async close() {
    try {
      await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
    } catch {
      /* already gone */
    }
  }
}

/** Collects the cookies a login response set, as raw Set-Cookie strings. */
async function loginOnce(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP },
    body: JSON.stringify(payload),
  });
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null), cookies };
}

/**
 * Puts goods in the basket through the same API the basket page uses, but from
 * inside the page so the browser's own cart cookie and localStorage entry are
 * the ones being written.
 *
 * The page owns the cart id: it creates one when it mounts and the server
 * matches every write against the cookie holding that id, so minting a separate
 * cart here only races the page and the writes start failing with 404. Waiting
 * for the id the page chose, and retrying a line, keeps the run reproducible.
 */
async function fillCart(page) {
  return page.js(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let cartId = Number(localStorage.getItem('mu-katale.cartId'));
    for (let tick = 0; Number.isNaN(cartId) || cartId === 0; tick += 1) {
      if (tick > 60) return 'the page never created a cart';
      await sleep(250);
      cartId = Number(localStorage.getItem('mu-katale.cartId'));
    }
    for (const [productId, quantity] of [[6, 2], [1, 3], [7, 1]]) {
      let added = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        added = await fetch('/api/cart/items', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cartId, productId, quantity }),
        });
        if (added.ok) break;
        await sleep(400);
        // The page may have taken over a different cart in the meantime.
        const current = Number(localStorage.getItem('mu-katale.cartId'));
        if (current && current !== cartId) cartId = current;
      }
      if (!added.ok) return 'item ' + productId + ' failed ' + added.status;
    }
    return cartId;
  })()`);
}

async function main() {
  // Chrome is opened before anything is deleted: a run that cannot get a browser
  // of its own should leave the previous set alone rather than clear it and fail.
  const { child, wsUrl } = await startChrome();
  chromeChild = child;

  // Start from an empty folder, so a screen that fails to capture this run
  // cannot be mistaken for an old picture of it.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await connect(wsUrl);
  const manifest = [];

  const customer = await loginOnce(`${API}/customers/login`, {
    phone: envValue('DEV_CUSTOMER_PHONE') || '0772000001',
    password: envValue('DEV_CUSTOMER_PASSWORD') || 'dev-demo-2026',
  });
  if (!customer.ok) throw new Error(`Customer login failed (${customer.status}). Is the dev account seeded?`);
  const admin = await loginOnce(`${API}/admin/login`, {
    email: envValue('ADMIN_EMAIL'),
    password: envValue('ADMIN_PASSWORD'),
  });
  if (!admin.ok) throw new Error(`Admin login failed (${admin.status}).`);

  console.log('\nCustomer journey');
  const shop = new Screen(cdp, 'shop');
  await shop.open();
  await shop.cookie(customer.cookies.find((c) => c.startsWith('mk_customer_session')));

  await shop.go(`${APP}/`);
  await shop.shoot('01-home.png');
  manifest.push(['01-home.png', '/', 'Catalogue home: hero, categories, product grid']);

  await shop.scrollBy(760);
  await sleep(600);
  await shop.shoot('02-home-below-fold.png');
  manifest.push(['02-home-below-fold.png', '/', 'Home scrolled to the product grid']);

  // The drawer carries the whole navigation, so the prototype needs it. The
  // header button is the one with no label, identified by its position class.
  await shop.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.className.includes('left-5')); if (b) b.click(); })()`);
  // The session is checked over the API on load, and the cold route can take a
  // few seconds. Waiting for "My Page" means the drawer is captured as it looks
  // to a signed-in shopper rather than as the signed-out list.
  const signedInDrawer = await shop.waitForText('My Page', 30000);
  if (!signedInDrawer) console.log('  warning: drawer still shows the signed-out menu');
  await sleep(400);
  await shop.shoot('02a-menu-drawer.png');
  manifest.push(['02a-menu-drawer.png', '/', 'Navigation drawer over the home page']);
  await shop.js(`(() => { const b = [...document.querySelectorAll('div')].find((x) => x.className.includes('bg-black/50')); if (b) b.click(); })()`);
  await sleep(600);

  await shop.go(`${APP}/product/6`);
  await shop.js(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/\\+/.test(x.textContent)); if(b) b.click(); })()`);
  await sleep(400);
  await shop.js(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/\\+/.test(x.textContent)); if(b) b.click(); })()`);
  await sleep(400);
  await shop.shoot('03-product-detail.png');
  manifest.push(['03-product-detail.png', '/product/6', 'Product detail with quantity chosen']);

  await shop.clickText('Add .* to basket|Add to basket|basket');
  await sleep(1400);
  await shop.shoot('04-added-to-basket.png');
  manifest.push(['04-added-to-basket.png', '/product/6', 'Confirmation that the basket took the goods']);

  // The empty basket is the state a shopper meets before buying anything, and
  // the one they fall back to if they change their mind, so it is worth a frame.
  await shop.js(`localStorage.removeItem('mu-katale.cartId')`);
  await shop.go(`${APP}/basket`);
  await shop.waitForAbsent('Loading');
  await shop.shoot('04a-basket-empty.png');
  manifest.push(['04a-basket-empty.png', '/basket', 'Empty basket with the way back to the shop']);

  const filled = await fillCart(shop);
  if (typeof filled !== 'number') throw new Error(`Could not fill the basket: ${filled}`);
  console.log(`  cart ${filled} has bananas, garlic and avocados`);

  await shop.go(`${APP}/basket`);
  await shop.waitForAbsent('Loading');
  await shop.shoot('05-basket.png');
  manifest.push(['05-basket.png', '/basket', 'Basket with lines, totals and delivery fee']);

  await shop.go(`${APP}/checkout`);
  await shop.waitForAbsent('Loading');
  await shop.shoot('06-checkout.png');
  manifest.push(['06-checkout.png', '/checkout', 'Checkout: delivery details and payment choice']);

  // The order is placed through the API using the very cart the browser built,
  // so the reference on the confirmation screen is a real one.
  const cartId = await shop.js(`localStorage.getItem('mu-katale.cartId')`);
  // mk_cart is scoped to /api, so asking for cookies at the site root returns
  // nothing useful and the order would come back "Cart not found".
  const jar = await cdp.send('Network.getCookies', { urls: [`${APP}/api/cart`] }, shop.sessionId).catch(() => null);
  const cartCookie = (jar?.cookies ?? []).find((c) => c.name === 'mk_cart')?.value;
  const customerCookie = (customer.cookies.find((c) => c.startsWith('mk_customer_session')) ?? '').split(';')[0];

  const orderRes = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      cookie: [customerCookie, cartCookie ? `mk_cart=${cartCookie}` : null].filter(Boolean).join('; '),
    },
    body: JSON.stringify({ cartId: Number(cartId) }),
  });
  const orderBody = await orderRes.json().catch(() => null);
  const reference = orderBody?.data?.reference ?? orderBody?.reference ?? null;
  if (!reference) throw new Error(`Order creation failed (${orderBody ? JSON.stringify(orderBody).slice(0, 160) : 'no body'})`);
  console.log(`  order ${reference} created`);

  await shop.go(`${APP}/order/${reference}`);
  await shop.shoot('07-order-confirmation.png');
  manifest.push([`07-order-confirmation.png`, `/order/${reference}`, 'Order confirmation after checkout']);

  await shop.go(`${APP}/pay/${reference}`);
  // The button reads "Order unavailable" until the cart id has been read back
  // from storage, so waiting for the live label avoids a picture of a dead end.
  const payable = await shop.waitForText('Pay now', 25000);
  if (!payable) console.log('  warning: payment button never became live');
  await sleep(500);
  await shop.shoot('08-payment.png');
  manifest.push(['08-payment.png', `/pay/${reference}`, 'Payment: mobile money or cash on delivery']);

  // The same screen with the number typed, so the prototype also shows the
  // state where the button is live rather than only the empty form.
  await shop.type('input[placeholder^="07XX"]', '0772000001');
  await sleep(700);
  await shop.shoot('08b-payment-number-entered.png');
  manifest.push(['08b-payment-number-entered.png', `/pay/${reference}`, 'Payment ready: number accepted, Pay now live']);

  // The order is created first and paid for afterwards, which is how the app
  // works: checkout takes the details, the payment screen takes the channel.
  const shopCookies = [customerCookie, cartCookie ? `mk_cart=${cartCookie}` : null].filter(Boolean).join('; ');
  const intent = await fetch(`${API}/payments/intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP, cookie: shopCookies },
    body: JSON.stringify({
      cartId: Number(cartId),
      orderReference: reference,
      channel: 'cod',
      provider: 'Cash on delivery',
    }),
  });
  console.log(`  cash on delivery: ${intent.status} ${(await intent.text()).slice(0, 90)}`);

  // Push the order along the fulfilment machine so the tracking screen has a
  // timeline and a money state worth looking at. The market refuses to start
  // fulfilment on an unpaid order, so the cash is collected first, exactly as
  // a shop assistant would.
  const asAdmin = {
    'content-type': 'application/json',
    origin: APP,
    cookie: (admin.cookies.find((c) => c.startsWith('mk_admin_session')) ?? '').split(';')[0],
  };
  const collected = await fetch(`${API}/admin/orders/${reference}/collect-cash`, {
    method: 'POST',
    headers: asAdmin,
  });
  console.log(`  collect cash: ${collected.status} ${(await collected.text()).slice(0, 120)}`);

  for (const status of ['processing', 'shipped']) {
    const patch = await fetch(`${API}/admin/orders/${reference}`, {
      method: 'PATCH',
      headers: asAdmin,
      body: JSON.stringify({ status, note: 'On the way to the school' }),
    });
    const text = await patch.text();
    console.log(`  status -> ${status}: ${patch.status} ${patch.ok ? '' : text.slice(0, 140)}`);
    await sleep(400);
  }

  await shop.go(`${APP}/order/${reference}`);
  await shop.shoot('09-order-tracking-timeline.png');
  manifest.push(['09-order-tracking-timeline.png', `/order/${reference}`, 'Tracking with staff-entered timeline and delivery status']);

  await shop.go(`${APP}/profile`);
  await shop.waitForAbsent('Loading');
  await shop.shoot('10-account-overview.png');
  manifest.push(['10-account-overview.png', '/profile', 'Account overview: totals and recent activity']);

  for (const [label, file, note] of [
    ['Orders', '11-account-orders.png', 'Order history list with money states'],
    ['Details', '12-account-details.png', 'Editable profile details'],
    ['Preferences', '13-account-preferences.png', 'Notification and shopping preferences'],
  ]) {
    const clicked = await shop.clickText(`^${label}$`);
    if (!clicked) {
      console.log(`  skipped ${label}: no such tab`);
      continue;
    }
    await shop.settle();
    await shop.shoot(file);
    manifest.push([file, '/profile', `${label} tab — ${note}`]);
  }

  await shop.close();

  console.log('\nSigned out screens');
  const guest = new Screen(cdp, 'guest');
  await guest.open();
  for (const [url, file, note] of [
    ['/login', '20-login.png', 'Sign in by phone number'],
    ['/signup', '21-signup.png', 'Create account with contact details'],
    ['/map', '22-delivery-map.png', 'Delivery coverage map'],
    ['/news', '23-newsstand.png', 'Newsstand'],
    ['/about', '24-about.png', 'About the market'],
  ]) {
    await guest.go(`${APP}${url}`);
    await guest.shoot(file);
    manifest.push([file, url, note]);
  }

  // The staff gate with the form filled in, which is what a reviewer sees last
  // before the console.
  await guest.go(`${APP}/staff`);
  await guest.type('input[type=email], input[name=email], input[autocomplete="username"]', envValue('ADMIN_EMAIL'));
  await guest.type('input[type=password]', envValue('ADMIN_PASSWORD'));
  await guest.shoot('25-staff-signin.png');
  manifest.push(['25-staff-signin.png', '/staff', 'Staff sign-in gate']);
  await guest.close();

  // The buying tabs are empty on a fresh database and a prototype full of empty
  // tables teaches nobody anything, so one supplier and one purchase order are
  // raised through the same endpoints the staff console uses — but only when the
  // tables are still empty, so re-running does not pile up duplicates.
  const supplierList = await fetch(`${API}/admin/suppliers`, { headers: asAdmin }).then((r) => r.json());
  let supplierId = supplierList?.data?.[0]?.id ?? null;
  if (!supplierId) {
    const raised = await fetch(`${API}/admin/suppliers`, {
      method: 'POST',
      headers: asAdmin,
      body: JSON.stringify({
        name: 'Bukalasi Farm', contactName: 'Grace Wanyana', phone: '0772145890',
        district: 'Kapsheba', region: 'Western Region',
      }),
    });
    const body = await raised.json().catch(() => null);
    supplierId = body?.data?.id ?? null;
    console.log(`  supplier: ${raised.status} ${supplierId ? 'Bukalasi Farm added' : JSON.stringify(body).slice(0, 90)}`);
  }
  const purchaseOrders = await fetch(`${API}/admin/purchase-orders`, { headers: asAdmin }).then((r) => r.json());
  if (supplierId && !(purchaseOrders?.data?.length > 0)) {
    const raised = await fetch(`${API}/admin/purchase-orders`, {
      method: 'POST',
      headers: asAdmin,
      body: JSON.stringify({
        supplierId,
        note: 'Weekly restock for the school orders',
        items: [{ productId: 6, quantity: 60, unitPrice: 900 }, { productId: 1, quantity: 40, unitPrice: 2400 }],
      }),
    });
    const body = await raised.json().catch(() => null);
    console.log(`  purchase order: ${raised.status} ${body?.data?.reference ?? JSON.stringify(body).slice(0, 90)}`);
  }

  console.log('\nStaff console');
  const staff = new Screen(cdp, 'staff');
  await staff.open();
  await staff.cookie(admin.cookies.find((c) => c.startsWith('mk_admin_session')));
  await staff.go(`${APP}/staff`, 3600);
  // The gate resolves the session over the API, which is slow on a cold
  // compile. Shooting before it answers produced a picture of a spinner.
  const ready = await staff.waitForText('Activity log');
  if (!ready) console.log('  warning: staff console did not render in time');
  // An owner lands on Catalogue; the order desk is the screen the report needs
  // first, so go to it and wait for the queue to arrive.
  await staff.clickText('^Orders$');
  await staff.settle();
  await staff.waitForText('GRC-', 20000);
  await staff.shoot('30-staff-orders.png');
  manifest.push(['30-staff-orders.png', '/staff', 'Order desk: queue of incoming orders']);

  await staff.scrollBy(700);
  await sleep(500);
  await staff.shoot('31-staff-orders-scrolled.png');
  manifest.push(['31-staff-orders-scrolled.png', '/staff', 'Order desk, further down the queue']);

  // Open the first order in the queue, so the console shot shows the operations
  // panel rather than a list. The new order may be on a later page.
  const opened = await staff.js(`(() => {
    const hit = [...document.querySelectorAll('button')].find((el) => /GRC-/.test(el.textContent || ''));
    if (!hit) return false;
    hit.click();
    return true;
  })()`);
  if (opened) {
    await staff.settle('Loading', 15000);
    await staff.shoot('32-staff-order-detail.png');
    manifest.push(['32-staff-order-detail.png', '/staff', 'One order open: status, payment and stock actions']);
    // The detail view replaces the console, so go back to the tab bar before
    // walking the tabs.
    await staff.go(`${APP}/staff`, 2600);
    await staff.waitForText('Activity log', 20000);
  } else {
    console.log('  warning: could not open the order in the queue');
  }

  for (const [label, file, note] of [
    ['Catalogue', '40-staff-catalogue.png', 'Product listing and price editing'],
    ['Inventory', '41-staff-inventory.png', 'Stock levels and movements'],
    ['Purchase orders', '42-staff-purchase-orders.png', 'Buying from suppliers'],
    ['Suppliers', '43-staff-suppliers.png', 'Supplier records'],
    ['Promotions', '44-staff-promotions.png', 'Discount codes'],
    ['Analytics', '45-staff-analytics.png', 'Sales figures'],
    ['Activity log', '46-staff-activity.png', 'Audit trail of staff actions'],
    ['Customers', '47-staff-customers.png', 'Customer directory'],
    ['Admins', '48-staff-admins.png', 'Staff accounts and roles'],
  ]) {
    const clicked = await staff.clickText(`^${label}$`);
    if (!clicked) {
      console.log(`  skipped ${label}: tab not present for this role`);
      continue;
    }
    await staff.settle();
    await staff.shoot(file);
    manifest.push([file, '/staff', note]);
  }
  await staff.close();

  fs.writeFileSync(
    path.join(OUT, 'INDEX.md'),
    ['# Screenshot index', '', '| file | route | what it shows |', '| --- | --- | --- |',
      ...manifest.map(([f, r, n]) => `| ${f} | \`${r}\` | ${n} |`), '',
      `Captured at ${WIDTH}x${HEIGHT} with a 2x scale factor, so each PNG is ${WIDTH * 2}x${HEIGHT * 2} and drops into a Figma phone frame at exactly ${WIDTH}x${HEIGHT}.`,
      `Order used for the live states: \`${reference}\`.`,
    ].join('\n'),
  );

  cdp.ws.close();
  child.kill();
  console.log(`\n${manifest.length} screens in design/hifi`);
}

main().catch((err) => {
  console.error('\nCAPTURE FAILED:', err.message);
  // An orphaned headless Chrome holds port 9335, which is how the next run gets
  // a browser it does not own.
  chromeChild?.kill();
  process.exit(1);
});
