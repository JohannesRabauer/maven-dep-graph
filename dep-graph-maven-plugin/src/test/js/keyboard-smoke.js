/**
 * Keyboard smoke test for a generated dep-graph page, driven over the DevTools protocol in
 * headless Edge. The canvas itself is a <canvas>, so the assertions read the page's aria-live
 * region and the context menu instead of the drawn nodes.
 *
 * Usage: node keyboard-smoke.js <page.html>
 * The browser is killed after TIMEOUT_MS no matter what.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TIMEOUT_MS = 50000;
const PORT = 9333;
const page = path.resolve(process.argv[2]);
const profile = path.join(path.dirname(page), 'cdp-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const child = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--remote-debugging-port=' + PORT,
  '--window-size=1600,1000',
  'file:///' + page.replace(/\\/g, '/')
], { windowsHide: true, stdio: 'ignore' });

let done = false;
const timer = setTimeout(() => finish(1, 'TIMEOUT after ' + TIMEOUT_MS + ' ms'), TIMEOUT_MS);

function finish(code, message) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (message) console.log(message);
  try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const hit = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (hit) return hit.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('no DevTools target');
}

(async () => {
  const ws = new WebSocket(await target());
  const pending = new Map();
  let nextId = 1;
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (slot) {
      pending.delete(msg.id);
      msg.error ? slot.reject(new Error(JSON.stringify(msg.error))) : slot.resolve(msg.result);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + expression);
    return res.result.value;
  }

  const key = (k, shift) => evaluate(
    "document.getElementById('cy').dispatchEvent(new KeyboardEvent('keydown', "
    + "{ key: " + JSON.stringify(k) + ", shiftKey: " + !!shift + ", bubbles: true, cancelable: true })), 1");

  for (let i = 0; i < 60 && !(await evaluate('document.body.dataset.ready === "true"')); i++) {
    await sleep(250);
  }
  const failures = [];
  const check = (name, ok, detail) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' -> ' + detail));
    if (!ok) failures.push(name);
  };

  check('page initialised', await evaluate('document.body.dataset.ready === "true"'),
      await evaluate('document.body.dataset.error || "no error"'));

  await evaluate("document.getElementById('cy').focus()");
  await sleep(100);
  const first = await evaluate("document.getElementById('a11y-live').textContent");
  check('focus seeds a node', !!first, first);

  // Expand first: on a large reactor nothing is open, so there is nowhere to arrow down to yet.
  if (/collapsed/.test(first)) {
    await key('Enter');
    await sleep(600);
  }

  await key('ArrowDown');
  await sleep(200);
  const down = await evaluate("document.getElementById('a11y-live').textContent");
  check('ArrowDown moves the focus', !!down && down !== first, down);

  await key('ArrowUp');
  await sleep(200);
  const up = await evaluate("document.getElementById('a11y-live').textContent");
  check('ArrowUp moves back', /^(service-0|a) /.test(up) || up === first, up);

  await key('Enter');
  await sleep(600);
  const toggled = await evaluate("document.getElementById('a11y-live').textContent");
  check('Enter toggles expansion', /collapsed|expanded/.test(toggled), toggled);
  check('Enter also selects', !(await evaluate("document.getElementById('panel').hidden")));

  await key('F10', true);
  await sleep(200);
  check('Shift+F10 opens the menu', !(await evaluate("document.getElementById('context-menu').hidden")));

  await evaluate("document.getElementById('context-menu').dispatchEvent("
      + "new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })), 1");
  await sleep(200);
  check('Tab closes the menu', await evaluate("document.getElementById('context-menu').hidden"));

  await evaluate("document.getElementById('search').focus()");
  await evaluate("document.getElementById('search').dispatchEvent(new KeyboardEvent('keydown', "
      + "{ key: 'F10', shiftKey: true, bubbles: true, cancelable: true })), 1");
  await sleep(200);
  check('Shift+F10 is inert in the search box',
      await evaluate("document.getElementById('context-menu').hidden"));

  // M2: revealing an artifact must also highlight the path that was expanded to reach it.
  const revealed = await evaluate("(function () {"
      + " const g = window.depGraph;"
      + " const deep = g.model.data.nodes.find(function (n) { return !g.model.moduleIds.has(n.id); });"
      + " g.reveal(deep.id);"
      + " return new Promise(function (r) { setTimeout(function () { r({"
      + "   path: (g.state.revealedPath || []).length,"
      + "   marked: g.cy.elements('.on-revealed-path').length }); }, 600); });"
      + "})()");
  check('reveal highlights the whole path', revealed.path > 1 && revealed.marked >= 3,
      JSON.stringify(revealed));

  // M7: focusing the paths from root must dim the edges of dimmed nodes too.
  const dimmed = await evaluate("(function () {"
      + " const g = window.depGraph;"
      + " const menu = document.getElementById('context-menu');"
      + " const deep = g.model.data.nodes.find(function (n) { return !g.model.moduleIds.has(n.id); });"
      + " g.select(deep.id);"
      + " document.getElementById('cy').dispatchEvent(new KeyboardEvent('keydown',"
      + "   { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));"
      + " const item = Array.prototype.find.call(menu.querySelectorAll('button'), function (b) {"
      + "   return /paths from root/i.test(b.textContent); });"
      + " if (!item) return { error: 'no paths item' };"
      + " item.click();"
      + " return new Promise(function (r) { setTimeout(function () {"
      + "   const bad = g.cy.edges().filter(function (e) {"
      + "     return e.data('dim') === 1"
      + "       && e.source().data('dim') !== 1 && e.target().data('dim') !== 1; }).length;"
      + "   r({ dimmedNodes: g.cy.nodes('[dim = 1]').length,"
      + "       dimmedEdges: g.cy.edges('[dim = 1]').length, inconsistent: bad }); }, 600); });"
      + "})()");
  check('paths focus dims the edges of dimmed nodes',
      !dimmed.error && dimmed.dimmedNodes > 0 && dimmed.dimmedEdges > 0 && dimmed.inconsistent === 0,
      JSON.stringify(dimmed));

  // Finding 1: a collapsed module must carry the count of the conflicts hidden beneath it.
  const badges = await evaluate("(function () {"
      + " const g = window.depGraph;"
      + " g.state.selected = null;"
      + " g.model.modules.forEach(function (m) { g.state.expanded.delete(m.nodeId); });"
      + " g.render();"
      + " return new Promise(function (r) { setTimeout(function () {"
      + "   g.cy.zoom(1);"           // badges are suppressed below 0.6, and a big reactor starts far out
      + "   g.cy.center();"
      + "   g.render();"
      + "   setTimeout(function () {"
      + "     r(Array.prototype.map.call(document.querySelectorAll('#badges .badge'),"
      + "       function (b) { return b.textContent; })); }, 600);"
      + " }, 600); });"
      + "})()");
  check('collapsed modules carry their hidden conflict count',
      badges.length > 0 && badges.every(function (t) { return Number(t) > 0; }), JSON.stringify(badges));

  finish(failures.length ? 1 : 0, failures.length ? 'FAILED: ' + failures.join(', ') : 'all keyboard checks passed');
})().catch((e) => finish(1, 'ERROR ' + e.message));
