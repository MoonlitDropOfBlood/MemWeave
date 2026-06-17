// scripts/playwright-verify-graph.mjs
// Take a screenshot of the GraphPage to verify the layout fix.
// Uses system Microsoft Edge via Playwright's msedge channel
// (no Chromium download required - Edge is already installed).

import { chromium } from 'file:///C:/Users/wwhby/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const MEMORY_ID = process.argv[2] || '1c285755-b371-4e2c-958f-099850968748';
const URL = `http://127.0.0.1:3131/ui/memories/${MEMORY_ID}/graph`;
const OUT = process.argv[3] || 'C:/Users/wwhby/AppData/Local/Temp/graph-screenshot.png';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

page.on('console', (msg) => {
  console.log(`[browser ${msg.type()}]`, msg.text());
});
page.on('pageerror', (err) => {
  console.log('[browser pageerror]', err.message);
});
page.on('response', (resp) => {
  console.log(`[network ${resp.status()}]`, resp.url());
});

console.log('navigating to', URL);
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });

let rflowFound = null;
for (let i = 0; i < 60; i++) {
  const found = await page.evaluate(() => {
    const sel = ['.react-flow', '[data-testid="graph-flow"]', '.react-flow__renderer', '.react-flow__viewport', '.react-flow__pane'].find((s) => document.querySelector(s));
    return sel || null;
  });
  if (found) {
    rflowFound = found;
    break;
  }
  await page.waitForTimeout(500);
}
console.log('ReactFlow selector found:', rflowFound ?? '(none)');

// If still not found, dump the canvas innerHTML for diagnosis
if (!rflowFound) {
  const canvasHTML = await page.evaluate(() => {
    const c = document.querySelector('[class*="canvas"]');
    return c ? c.outerHTML.substring(0, 600) : 'no canvas';
  });
  console.log('canvas innerHTML:', canvasHTML);
}

await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: false });
console.log('screenshot saved to', OUT);

const dims = await page.evaluate(() => {
  const get = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // Get all memory nodes inside react-flow
  const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((n) => {
    const r = n.getBoundingClientRect();
    return { id: n.getAttribute('data-id') || '?', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (n.textContent || '').slice(0, 30) };
  });
  return {
    bodyHTML_size: document.body.innerHTML.length,
    rootChildren: document.getElementById('root')?.children?.length ?? 0,
    page: get('[class*="page"]'),
    controls: get('[class*="controls"]'),
    canvas: get('[class*="canvas"]'),
    flowWrap: get('[class*="flowWrap"]'),
    reactFlow: get('.react-flow'),
    nodes,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
});
console.log('layout:', JSON.stringify(dims, null, 2));

// Verdict: do all nodes fall inside the canvas bounding box?
const verdict = dims.nodes.every((n) => {
  const c = dims.canvas;
  if (!c) return false;
  const insideX = n.x >= c.x - 50 && n.x + n.w <= c.x + c.w + 50;
  const insideY = n.y >= c.y - 50 && n.y + n.h <= c.y + c.h + 50;
  return insideX && insideY;
});
console.log('VERDICT: all nodes inside canvas bounds =', verdict);

await browser.close();
