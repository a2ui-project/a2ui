/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * End-to-end harness: renders the inbox card in a minimal MCP Apps host
 * (scripts/e2e/host.js) in headless Chromium, under the default MCP Apps CSP in
 * a cross-origin sandboxed frame, connected to the real MCP server over stdio,
 * and runs the interactive checks. Each check saves a screenshot.
 *
 * Usage: yarn build && yarn e2e
 *
 * Environment:
 * - A2UI_E2E_OUT: screenshot and report directory. Optional (default: /tmp/a2ui-embed-inbox-e2e).
 * - A2UI_E2E_CHROME: Chrome executable. Optional (default: Playwright's Chromium).
 * - A2UI_E2E_NO_AI: set to 1 for rule-based picks even when the server's .env has a Gemini key.
 * - A2UI_E2E_CHECKS: comma-separated check letters to run, such as `b,c`. Optional (default: all).
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/a2ui-embed-inbox-e2e';
const noAi = process.env['A2UI_E2E_NO_AI'] === '1';

const APP_URI = 'ui://a2ui/app.html';

/**
 * The CSP an MCP Apps host applies to an app resource: the default policy
 * plus the origins the resource declares in `_meta.ui.csp.resourceDomains`.
 */
function appCsp(resourceDomains = []) {
  const extra = resourceDomains.length > 0 ? ` ${resourceDomains.join(' ')}` : '';
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${extra}`,
    `style-src 'unsafe-inline'${extra}`,
    `img-src data: blob:${extra}`,
    `font-src${extra || " 'none'"}`,
    `media-src data: blob:${extra}`,
    "connect-src 'none'",
  ].join('; ');
}

/** Traces of A2UI in text, which must never reach the model. */
const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;

/** Records CSP violations in every frame before any page script runs. */
const CSP_RECORDER = `
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', event => {
    window.__cspViolations.push(event.violatedDirective + ' ' + (event.blockedURI || ''));
  });
`;

function listen(server, host) {
  return new Promise(resolve => server.listen(0, host, () => resolve(server.address().port)));
}

async function bundleHost() {
  const result = await build({
    entryPoints: [join(packageRoot, 'scripts', 'e2e', 'host.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function envFileHasKey() {
  if (noAi) return false;
  if (process.env['GEMINI_API_KEY']) return true;
  const result = spawnSync('grep', ['-Eq', '^GEMINI_API_KEY=.+', join(packageRoot, '.env')]);
  return result.status === 0;
}

/** Runs the harness and returns the report. */
async function run() {
  mkdirSync(outDir, {recursive: true});
  const report = {
    ai: envFileHasKey(),
    checks: [],
    toolResults: [],
    frameHeights: {},
    consoleErrors: [],
    consoleWarnings: [],
  };

  // The real server, launched the way an MCP host launches it.
  const client = new Client({name: 'a2ui-embed-inbox-e2e', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--preserve-symlinks', join(packageRoot, 'dist', 'server.js')],
      env: {...process.env, ...(noAi ? {GEMINI_API_KEY: ''} : {})},
      stderr: 'inherit',
    }),
  );

  async function callTool(params, source) {
    const result = await client.callTool(params, undefined, {timeout: 120_000});
    const text = (result.content ?? []).map(block => block.text ?? '').join('\n');
    report.toolResults.push({
      source,
      name: params.name,
      action: params.arguments?.name,
      isError: Boolean(result.isError),
      structuredContentBytes: result.structuredContent
        ? Buffer.byteLength(JSON.stringify(result.structuredContent))
        : 0,
      contentHasA2ui: A2UI_IN_TEXT.test(text),
      text: text.slice(0, 300),
    });
    return result;
  }

  // The app resource, served from its own origin with the CSP it declares.
  const {contents} = await client.readResource({uri: APP_URI});
  const appHtml = contents[0].text;
  const csp = appCsp(contents[0]._meta?.ui?.csp?.resourceDomains ?? []);
  report.csp = csp;
  const appServer = createServer((request, response) => {
    if (request.url !== '/app.html') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
    });
    response.end(appHtml);
  });
  const appUrl = `http://localhost:${await listen(appServer, '127.0.0.1')}/app.html`;

  // The host page, on another origin.
  const hostScript = await bundleHost();
  const hostServer = createServer((request, response) => {
    if (request.url === '/host.js') {
      response.writeHead(200, {'Content-Type': 'text/javascript'}).end(hostScript);
      return;
    }
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>e2e host</title>' +
        '<style>body{font-family:sans-serif;margin:16px}h2{font-size:12px;color:#777}</style>' +
        '</head><body><script type="module" src="/host.js"></script></body></html>',
    );
  });
  const hostUrl = `http://127.0.0.1:${await listen(hostServer, '127.0.0.1')}/`;

  const executablePath = process.env['A2UI_E2E_CHROME'];
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  const context = await browser.newContext({viewport: {width: 800, height: 1000}});
  await context.addInitScript(CSP_RECORDER);
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
    if (message.type() === 'warning') report.consoleWarnings.push(message.text());
  });
  await page.exposeFunction('harnessCallTool', params => callTool(params, 'app'));
  await page.goto(hostUrl);
  await page.waitForFunction(() => window.host !== undefined);

  /** Calls a tool as the model would and renders its result in a new frame. */
  async function render(name, args, theme = 'light') {
    const started = Date.now();
    const result = await callTool({name, arguments: args}, 'model');
    (report.toolMs ??= []).push(Date.now() - started);
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    const id = await page.evaluate(
      ([url, toolArgs, toolResult, hostTheme]) =>
        window.host.render(url, toolArgs, toolResult, hostTheme),
      [appUrl, args, result, theme],
    );
    const frame = page.frameLocator(`#${id}`);
    const text = (result.content ?? []).map(block => block.text ?? '').join('\n');
    return {id, frame, result, text};
  }

  async function screenshot(id, name) {
    const path = join(outDir, `${name}.png`);
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.locator(`#${id}`).screenshot({path});
    return path;
  }

  async function hostLog() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.host.log)));
  }

  /** Records the height the app reports once its first render settles. */
  async function recordNaturalHeight(id, view) {
    await new Promise(resolve => setTimeout(resolve, 800));
    const {sizes} = await hostLog();
    const last = sizes.filter(entry => entry.frame === id).at(-1);
    (report.naturalHeights ??= {})[view] = last?.params.height;
  }

  async function frameCount() {
    return page.locator('iframe').count();
  }

  /** Waits until the host log has a new entry of `kind` that matches `predicate`. */
  async function waitForLog(kind, predicate, timeout = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const entries = (await hostLog())[kind];
      const found = entries.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`No ${kind} log entry matched within ${timeout} ms`);
  }

  async function actionCalls(frameId, name) {
    const {toolCalls} = await hostLog();
    return toolCalls.filter(call => call.frame === frameId && call.params.arguments?.name === name);
  }

  const only = process.env['A2UI_E2E_CHECKS']?.split(',');

  async function check(name, body) {
    if (only && !only.includes(name.charAt(0))) return;
    const started = Date.now();
    try {
      const details = await body();
      report.checks.push({
        name,
        status: details?.skipped ? 'skip' : 'pass',
        ms: Date.now() - started,
        ...details,
      });
    } catch (error) {
      const frames = page.frames().filter(frame => frame !== page.mainFrame());
      const last = frames.at(-1);
      report.failureDom ??= {};
      report.failureDom[name] = last
        ? await last.evaluate(() => document.body.innerText.slice(0, 2000)).catch(String)
        : '';
      report.checks.push({
        name,
        status: 'fail',
        ms: Date.now() - started,
        error: error instanceof Error ? error.message.split('\n')[0] : String(error),
      });
    }
  }

  const button = (frame, name) => frame.getByRole('button', {name, exact: true});
  const tab = (frame, title) => frame.getByRole('tab', {name: new RegExp(`^${title}`)});

  /** Fails when the open dialog doesn't fit in the frame. */
  async function dialogFits(dialog) {
    const fit = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return {top: box.top, bottom: box.bottom, viewport: window.innerHeight};
    });
    if (fit.top < 0 || fit.bottom > fit.viewport + 1) {
      throw new Error(`The dialog is clipped: ${JSON.stringify(fit)}`);
    }
  }

  let card;
  await check('a. the card renders every group with counts and fits the inline frame', async () => {
    card = await render('inbox_decisions', {});
    const {frame, id} = card;
    await tab(frame, 'Reply · 3').waitFor({timeout: 60_000});
    await frame.getByText('12 emails need you').waitFor();
    await recordNaturalHeight(id, 'card (Reply tab)');
    const tabs = await frame.getByRole('tab').allInnerTexts();
    const expected = ['Reply · 3', 'Calendar · 2', 'Money · 2', 'Clean up · 3', 'Review · 2'];
    if (JSON.stringify(tabs.map(title => title.trim())) !== JSON.stringify(expected)) {
      throw new Error(`Tabs are ${JSON.stringify(tabs)}`);
    }
    const shots = [await screenshot(id, 'a-card-reply')];
    for (const [title, name] of [
      ['Calendar', 'calendar'],
      ['Money', 'money'],
      ['Clean up', 'cleanup'],
      ['Review', 'review'],
    ]) {
      await tab(frame, title).click();
      await recordNaturalHeight(id, `card (${title} tab)`);
      shots.push(await screenshot(id, `a-card-${name}`));
    }
    const tooTall = Object.entries(report.naturalHeights).filter(([, height]) => height > 800);
    if (tooTall.length > 0) throw new Error(`Taller than 800 px: ${JSON.stringify(tooTall)}`);
    await tab(frame, 'Reply').click();
    return {screenshot: shots, source: card.text.match(/Picks[^.]*\./)?.[0]};
  });

  await check('b. dark theme from the host context (before any change)', async () => {
    const dark = await render('inbox_decisions', {focus: 'calendar'}, 'dark');
    await dark.frame
      .getByText(/needs? you/)
      .first()
      .waitFor({timeout: 60_000});
    await recordNaturalHeight(dark.id, 'dark (calendar focus)');
    const full = await render('inbox_decisions', {}, 'dark');
    await full.frame.getByRole('tab', {name: /^Reply · 3/}).waitFor({timeout: 60_000});
    await recordNaturalHeight(full.id, 'dark (full card)');
    return {
      screenshot: [
        await screenshot(dark.id, 'b-dark-calendar'),
        await screenshot(full.id, 'b-dark-card'),
      ],
    };
  });

  const myDraft = "Yes! I land at 8:55 PM on Friday (NS 1424). Can't wait to see Grandma!\n\nMaya";
  await check(
    'c. change a choice, rewrite and edit a draft; model context carries them',
    async () => {
      const {frame, id} = card;
      const frames = await frameCount();
      await tab(frame, 'Calendar').click();
      // The offsite's pick is Decline; Accept without a star is the override,
      // and the row's reason and "what happens" lines follow it.
      await button(frame, 'Accept').click();
      await frame.getByText('Your choice: Accept · ★ My pick was Decline').waitFor({timeout: 5000});
      await frame
        .getByText("What happens: Added to your calendar; Priya sees you're going.")
        .waitFor({timeout: 5000});
      const followShot = await screenshot(id, 'c-choice-follows');
      await tab(frame, 'Reply').click();
      await button(frame, 'Edit reply').first().click();
      const dialog = frame.getByRole('dialog');
      const draft = dialog.locator('textarea');
      await draft.waitFor();
      await dialogFits(dialog);
      const box = await draft.evaluate(element => ({
        height: element.clientHeight,
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      }));
      if (box.height < box.lineHeight * 6) {
        throw new Error(`The reply box shows fewer than 6 lines: ${JSON.stringify(box)}`);
      }
      const before = await draft.inputValue();
      await dialog.getByRole('button', {name: 'Warmer', exact: true}).click();
      await dialog.getByRole('button', {name: 'Rewrite', exact: true}).click();
      const started = Date.now();
      let busyNoteSeen = false;
      while ((await draft.inputValue()) === before && Date.now() - started < 50_000) {
        busyNoteSeen ||= await dialog.getByText('Rewriting your reply…').isVisible();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const rewriteMs = Date.now() - started;
      const rewritten = await draft.inputValue();
      if (rewritten === before) throw new Error('Rewrite did not change the draft');
      if (!rewritten.includes('\n\n')) {
        throw new Error(`The rewrite lost its paragraph breaks: ${JSON.stringify(rewritten)}`);
      }
      // With Gemini the rewrite takes seconds, so the busy note must show.
      if (envFileHasKey() && rewriteMs > 1000 && !busyNoteSeen) {
        throw new Error('No "Rewriting your reply…" note during a slow rewrite');
      }
      const rewriteShot = await screenshot(id, 'c-draft-rewritten');
      await draft.fill(myDraft);
      const context = await waitForLog(
        'modelContexts',
        entry => {
          const text = entry.params.content?.[0]?.text ?? '';
          return (
            entry.frame === id &&
            text.includes('"d05":{"choice":["accept"]') &&
            text.includes("Can't wait to see Grandma")
          );
        },
        15_000,
      );
      const contextBytes = Buffer.byteLength(context.params.content[0].text);
      if (contextBytes > 12 * 1024) throw new Error(`Model context is ${contextBytes} bytes`);
      const editShot = await screenshot(id, 'c-draft-edited');
      await dialog.getByRole('button', {name: 'Close'}).click();
      if ((await frameCount()) !== frames) throw new Error('Editing opened a new frame');
      return {
        screenshot: [followShot, rewriteShot, editShot],
        busyNoteSeen,
        replyBoxPx: box.height,
        rewriteMs,
        rewritten: rewritten.slice(0, 160),
        modelContextBytes: Buffer.byteLength(context.params.content[0].text),
      };
    },
  );

  await check('d. follow-up buttons post template messages with ui/message', async () => {
    const {frame, id} = card;
    await tab(frame, 'Calendar').click();
    await button(frame, 'Details').nth(1).click();
    const dialog = frame.getByRole('dialog');
    await dialog.getByText('Q1 planning offsite').first().waitFor();
    await dialogFits(dialog);
    const detailsShot = await screenshot(id, 'd-details');
    await dialog.getByRole('button', {name: 'Why this pick? Ask in chat', exact: true}).click();
    const why = await waitForLog(
      'messages',
      entry => entry.frame === id && JSON.stringify(entry.params).includes('Why do you recommend'),
    );
    await dialog.getByRole('button', {name: 'Close'}).click();
    await tab(frame, 'Reply').click();
    await button(frame, 'Edit reply').first().click();
    await dialog.getByRole('button', {name: 'Shorter', exact: true}).click();
    await dialog.getByRole('button', {name: 'Ask in chat', exact: true}).click();
    const rewrite = await waitForLog(
      'messages',
      entry => entry.frame === id && JSON.stringify(entry.params).includes('Rewrite my reply'),
    );
    await dialog.getByRole('button', {name: 'Close'}).click();
    const texts = [why, rewrite].map(entry => entry.params.content[0].text);
    if (
      !/^Why do you recommend "Decline" for "Invitation: Q1 planning offsite/.test(texts[0]) ||
      !texts[1].startsWith(
        'Rewrite my reply to "Linda Chen" to be "shorter". Answer with only the new reply text',
      )
    ) {
      throw new Error(`Unexpected follow-ups: ${JSON.stringify(texts)}`);
    }
    return {screenshot: detailsShot, messages: texts};
  });

  await check('e. Apply opens a confirm step that lists the right actions', async () => {
    const {frame, id} = card;
    const frames = await frameCount();
    await button(frame, 'Apply 12 decisions').click();
    await frame.getByText('Apply 12 decisions?').waitFor({timeout: 10_000});
    const summary = await frame
      .getByText(/^Send 2 replies/)
      .first()
      .innerText();
    for (const part of [
      'accept 2 invites',
      'schedule $84.20 on Dec 1',
      'send Alex $42.50',
      'report 1 phishing email',
      'You changed 1 of my picks.',
    ]) {
      if (!summary.includes(part)) throw new Error(`Summary lacks "${part}": ${summary}`);
    }
    if (summary.includes('decline')) throw new Error(`Summary still declines: ${summary}`);
    await recordNaturalHeight(id, 'confirm step');
    if ((await frameCount()) !== frames) throw new Error('Apply opened a new frame');
    return {screenshot: await screenshot(id, 'e-confirm'), summary};
  });

  await check(
    'f. confirming applies in place with checks, and Undo brings an item back',
    async () => {
      const {frame, id} = card;
      const frames = await frameCount();
      await button(frame, 'Apply 12 decisions').click();
      await frame.getByText('All done').waitFor({timeout: 10_000});
      const appliedContext = await waitForLog(
        'modelContexts',
        entry => {
          const text = entry.params.content?.[0]?.text ?? '';
          return (
            entry.frame === id &&
            text.includes('"applied":[{"key":"d01","text":"✓ Reply sent to Mom') &&
            text.includes('$84.20 to Northwest Power & Light on Dec 1')
          );
        },
        10_000,
      );
      const appliedContextBytes = Buffer.byteLength(appliedContext.params.content[0].text);
      if (appliedContextBytes > 12 * 1024) {
        throw new Error(`Model context is ${appliedContextBytes} bytes`);
      }
      await frame.getByText('✓ Reply sent to Mom').waitFor();
      await recordNaturalHeight(id, 'all done');
      const doneShot = await screenshot(id, 'f-all-done');
      const undoButtons = await button(frame, 'Undo').count();
      if (undoButtons !== 12)
        throw new Error(`"All done" lists ${undoButtons} items with Undo, not 12`);
      await frame.getByText(/^Scheduled: \$84\.20 to Northwest Power & Light on Dec 1/).waitFor();
      // The offsite is the fifth applied item.
      await button(frame, 'Undo').nth(4).click();
      await frame.getByText('1 email needs you').waitFor({timeout: 10_000});
      await button(frame, 'Apply 1 decision').waitFor();
      await tab(frame, 'Calendar · 1').waitFor();
      await tab(frame, 'Calendar · 1').click();
      await frame.getByText('Your choice: Accept · ★ My pick was Decline').waitFor();
      const undoShot = await screenshot(id, 'f-undo');
      if ((await frameCount()) !== frames) throw new Error('Apply opened a new frame');
      return {screenshot: [doneShot, undoShot], appliedContextBytes};
    },
  );

  await check('g. a group with nothing left gets a small card', async () => {
    const empty = await render('inbox_decisions', {focus: 'money'});
    await empty.frame.getByText('Nothing left in Money').waitFor({timeout: 30_000});
    await recordNaturalHeight(empty.id, 'empty (money focus)');
    if (!/Scheduled payments: \$84\.20/.test(empty.text)) {
      throw new Error(
        `The summary does not state the scheduled payment: ${empty.text.slice(0, 300)}`,
      );
    }
    return {
      screenshot: await screenshot(empty.id, 'g-empty-money'),
      text: empty.text.slice(0, 300),
    };
  });

  await check('h. no CSP violations and no A2UI in tool result text', async () => {
    const violations = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const list = await frame.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      violations.push(...list.map(entry => `${frame.name()}: ${entry}`));
    }
    const refused = report.consoleErrors.filter(message =>
      /Content Security Policy|Refused to/.test(message),
    );
    const leaking = report.toolResults.filter(result => result.contentHasA2ui);
    const failed = report.toolResults.filter(result => result.isError);
    if (violations.length > 0 || refused.length > 0 || leaking.length > 0 || failed.length > 0) {
      throw new Error(
        `violations=${JSON.stringify(violations)} refused=${JSON.stringify(refused)} leaking=${leaking.length} failed=${JSON.stringify(failed)}`,
      );
    }
    return {frames: page.frames().length - 1, toolResults: report.toolResults.length};
  });

  const {sizes, modelContexts} = await hostLog();
  for (const {frame, params} of sizes) {
    (report.frameHeights[frame] ??= []).push(params.height);
  }
  report.maxStructuredContentBytes = Math.max(
    ...report.toolResults.map(result => result.structuredContentBytes),
  );
  report.maxModelContextBytes = Math.max(
    0,
    ...modelContexts.map(entry => Buffer.byteLength(entry.params.content?.[0]?.text ?? '')),
  );
  report.appHtmlBytes = Buffer.byteLength(appHtml);
  report.markdownWarnings = report.consoleWarnings.filter(text =>
    text.includes('MarkdownDirective'),
  ).length;
  await page.screenshot({path: join(outDir, 'host-full.png'), fullPage: true});

  await browser.close();
  await client.close();
  appServer.close();
  hostServer.close();
  return report;
}

const report = await run();
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of report.checks) {
  const shots = [entry.screenshot].flat().filter(Boolean).join(', ');
  const detail = entry.error ?? entry.note ?? shots;
  console.log(
    `${entry.status.toUpperCase().padEnd(4)} ${entry.name}${detail ? ` (${detail})` : ''}`,
  );
}
console.log(`App HTML: ${report.appHtmlBytes} bytes`);
console.log(`Largest structuredContent: ${report.maxStructuredContentBytes} bytes`);
console.log(`Natural heights: ${JSON.stringify(report.naturalHeights)}`);
console.log(`Tool call times (ms): ${JSON.stringify(report.toolMs)}; AI key: ${report.ai}`);
console.log(`Largest model context: ${report.maxModelContextBytes} bytes`);
console.log(
  `Console errors: ${report.consoleErrors.length}, markdown warnings: ${report.markdownWarnings}`,
);
console.log(`Report: ${join(outDir, 'report.json')}`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
