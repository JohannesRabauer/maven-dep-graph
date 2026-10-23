/**
 * Measures page init and first-render time of a generated dep-graph page with headless Edge.
 * Usage: node measure-page.js <page.html>
 * The browser is killed after TIMEOUT_MS no matter what.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TIMEOUT_MS = 55000;
const page = path.resolve(process.argv[2]);

const child = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-extensions',
  '--window-size=1600,1000',
  '--virtual-time-budget=40000',
  '--run-all-compositor-stages-before-draw',
  '--dump-dom',
  'file:///' + page.replace(/\\/g, '/')
], { windowsHide: true });

let out = '';
let killed = false;
const timer = setTimeout(() => {
  killed = true;
  child.kill('SIGKILL');
}, TIMEOUT_MS);

const started = Date.now();
child.stdout.on('data', (d) => { out += d; });
child.on('close', () => {
  clearTimeout(timer);
  const wall = Date.now() - started;
  if (killed) {
    console.log('TIMEOUT after ' + TIMEOUT_MS + ' ms - browser killed');
    process.exit(1);
  }
  const body = /<body[^>]*>/i.exec(out);
  const attrs = body ? body[0] : '(no body tag in dumped DOM)';
  const ready = /data-ready-ms="(\d+)"/.exec(attrs);
  const first = /data-first-render-ms="(\d+)"/.exec(attrs);
  const error = /data-error="([^"]*)"/.exec(attrs);
  const nodes = (out.match(/class="[^"]*\bbadge\b/g) || []).length;
  console.log('body attrs : ' + attrs);
  console.log('ready       : ' + (ready ? ready[1] + ' ms' : 'NOT READY'));
  console.log('firstRender : ' + (first ? first[1] + ' ms' : 'n/a'));
  console.log('error       : ' + (error ? error[1] : 'none'));
  console.log('badges      : ' + nodes);
  console.log('wallClock   : ' + wall + ' ms');
  process.exit(ready && !error ? 0 : 1);
});
