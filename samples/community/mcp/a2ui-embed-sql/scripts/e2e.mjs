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
 * End-to-end harness: renders the sample's tool results in a minimal MCP Apps
 * host (scripts/e2e/host.js) in headless Chromium, connected to the real MCP
 * server over stdio, and runs the M1 checks. Each check saves a screenshot.
 *
 * Usage: yarn build && yarn e2e
 *
 * Environment:
 * - A2UI_E2E_OUT: screenshot and report directory. Optional (default: /tmp/a2ui-embed-sql-e2e).
 * - A2UI_E2E_CHROME: Chrome executable. Optional (default: Playwright's Chromium).
 * - GEMINI_API_KEY (or the server's .env): enables the explain check.
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
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/a2ui-embed-sql-e2e';

/** The CSP MCP Apps hosts apply to an app resource that declares no domains. */
const DEFAULT_MCP_APPS_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'";

const APP_URI = 'ui://a2ui/app.html';

const GENRE_REVENUE =
  'SELECT g.Name AS genre, SUM(il.UnitPrice*il.Quantity) AS revenue FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId JOIN Genre g ON g.GenreId = t.GenreId GROUP BY genre ORDER BY revenue DESC LIMIT 10';

const KPI_QUERY = 'SELECT ROUND(SUM(Total), 2) AS total_revenue FROM Invoice';

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Runs the harness and returns the report. */
async function run() {
  mkdirSync(outDir, {recursive: true});
  const report = {
    checks: [],
    toolResults: [],
    frameHeights: {},
    consoleErrors: [],
    consoleWarnings: [],
  };

  // The real server, launched the way an MCP host launches it.
  const client = new Client({name: 'a2ui-embed-sql-e2e', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--preserve-symlinks', join(packageRoot, 'dist', 'server.js')],
      env: {...process.env},
      stderr: 'inherit',
    }),
  );

  async function callTool(params, source) {
    const result = await client.callTool(params);
    const text = (result.content ?? []).map(block => block.text ?? '').join('\n');
    report.toolResults.push({
      source,
      name: params.name,
      isError: Boolean(result.isError),
      structuredContentBytes: result.structuredContent
        ? Buffer.byteLength(JSON.stringify(result.structuredContent))
        : 0,
      contentHasA2ui: A2UI_IN_TEXT.test(text),
      text: text.slice(0, 200),
    });
    return result;
  }

  // The app resource, served from its own origin with the default CSP header.
  const {contents} = await client.readResource({uri: APP_URI});
  const appHtml = contents[0].text;
  const appServer = createServer((request, response) => {
    if (request.url !== '/app.html') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': DEFAULT_MCP_APPS_CSP,
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
  async function render(name, args) {
    const result = await callTool({name, arguments: args}, 'model');
    const id = await page.evaluate(
      ([url, toolArgs, toolResult]) => window.host.render(url, toolArgs, toolResult),
      [appUrl, args, result],
    );
    const frame = page.frameLocator(`#${id}`);
    return {id, frame, result};
  }

  async function screenshot(id, name) {
    const path = join(outDir, `${name}.png`);
    await page.locator(`#${id}`).screenshot({path});
    return path;
  }

  async function hostLog() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.host.log)));
  }

  const only = process.env['A2UI_E2E_CHECKS']?.split(',');

  async function check(name, body) {
    if (only && !only.includes(name.charAt(0))) return;
    const started = Date.now();
    try {
      const details = await body();
      report.checks.push({name, status: 'pass', ms: Date.now() - started, ...details});
    } catch (error) {
      report.checks.push({
        name,
        status: 'fail',
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const tableCells = (frame, column = 1) =>
    frame
      .locator(`a2ui-sql-data-table:visible tbody tr td:nth-child(${column})`)
      .allTextContents()
      .then(cells => cells.map(cell => cell.trim()));

  await check('a. list_tables renders a schema browser', async () => {
    const {id, frame} = await render('list_tables', {});
    await frame.locator('a2ui-sql-data-table').first().waitFor();
    const tables = await tableCells(frame);
    if (!tables.includes('Invoice') || tables.length !== 11) {
      throw new Error(`Expected the 11 Chinook tables, got ${tables.join(', ')}`);
    }
    await frame.getByRole('tab', {name: 'Columns'}).click();
    const columns = await tableCells(frame);
    if (columns.length < 50) throw new Error(`Columns tab shows ${columns.length} rows`);
    await frame.getByRole('tab', {name: 'Tables'}).click();
    return {screenshot: await screenshot(id, 'a-list-tables'), tables: tables.length};
  });

  let genre;
  await check('b. grouped query renders chart and table tabs with a Vega SVG', async () => {
    genre = await render('query', {sql: GENRE_REVENUE, title: 'Revenue by genre'});
    const {frame} = genre;
    await frame.getByRole('tab', {name: 'Chart'}).waitFor();
    await frame.locator('a2ui-vega-chart svg').first().waitFor({timeout: 10000});
    const marks = await frame
      .locator('a2ui-vega-chart svg path.mark-rect, a2ui-vega-chart svg .mark-rect path')
      .count();
    const chartShot = await screenshot(genre.id, 'b-chart');
    await frame.getByRole('tab', {name: 'Table'}).click();
    await frame.locator('a2ui-sql-data-table:visible').waitFor();
    const cells = await tableCells(frame);
    if (cells[0] !== 'Rock') throw new Error(`First row is ${cells[0]}`);
    const tableShot = await screenshot(genre.id, 'b-table');
    return {screenshot: [chartShot, tableShot], rows: cells.length, barMarks: marks};
  });

  await check('c. clicking a header sorts the DataTable', async () => {
    const {frame, id} = genre;
    const before = await tableCells(frame, 2);
    await frame.locator('a2ui-sql-data-table:visible th button', {hasText: 'revenue'}).click();
    const after = await tableCells(frame, 2);
    const numbers = after.map(cell => Number(cell.replaceAll(',', '')));
    const ascending = numbers.every((value, index) => index === 0 || numbers[index - 1] <= value);
    if (!ascending || before.join() === after.join()) {
      throw new Error(`Rows did not sort: ${before.join(' ')} -> ${after.join(' ')}`);
    }
    const sortState = await frame
      .locator('a2ui-sql-data-table:visible th[aria-sort="ascending"]')
      .count();
    return {screenshot: await screenshot(id, 'c-sorted'), first: after[0], sortState};
  });

  await check('g. selecting a row updates the model context', async () => {
    const {frame, id} = genre;
    const row = frame.locator('a2ui-sql-data-table:visible tbody tr', {hasText: 'Rock'});
    await row.click();
    await sleep(800);
    const selected = await row.getAttribute('aria-selected');
    const {modelContexts} = await hostLog();
    const last = modelContexts.filter(entry => entry.frame === id).at(-1);
    const text = last?.params?.content?.map(block => block.text).join('\n') ?? '';
    if (!/"selected":\{"genre":"Rock","revenue":826\.6/.test(text)) {
      throw new Error(`No model context with the Rock row: ${text.slice(0, 300)}`);
    }
    // The rows are shared once (the chart reads /rows), plus the selected row.
    const rockCopies = text.split('"genre":"Rock"').length - 1;
    if (rockCopies !== 2)
      throw new Error(`The Rock row appears ${rockCopies} times in the context`);
    // Keyboard selection of another row.
    const jazz = frame.locator('a2ui-sql-data-table:visible tbody tr', {hasText: 'Jazz'});
    await jazz.focus();
    await jazz.press('Enter');
    await sleep(800);
    const afterKeyboard = (await hostLog()).modelContexts.filter(e => e.frame === id).at(-1);
    const keyboardText = afterKeyboard?.params?.content?.map(block => block.text).join('\n') ?? '';
    if (!keyboardText.includes('"genre":"Jazz"')) throw new Error('Keyboard selection not shared');
    return {
      screenshot: await screenshot(id, 'g-selected'),
      ariaSelected: selected,
      modelContextBytes: Buffer.byteLength(keyboardText),
      rockRowCopies: rockCopies,
      modelContextUpdates: modelContexts.length,
      modelContextSample: text.slice(0, 160),
    };
  });

  await check('d. Refresh calls a2ui_action and re-renders in place', async () => {
    const {frame, id} = genre;
    await frame
      .locator('a2ui-surface')
      .first()
      .evaluate(element => {
        element.dataset.e2eMarker = 'before-refresh';
      });
    const callsBefore = (await hostLog()).toolCalls.length;
    await frame.locator('a2ui-basic-button button', {hasText: 'Refresh'}).click();
    await page.waitForFunction(count => window.host.log.toolCalls.length > count, callsBefore);
    await sleep(500);
    const call = (await hostLog()).toolCalls.at(-1);
    if (call.params.name !== 'a2ui_action' || call.params.arguments.name !== 'refresh') {
      throw new Error(`Unexpected call ${JSON.stringify(call.params)}`);
    }
    const surfaces = await frame.locator('a2ui-surface').count();
    const marker = await frame
      .locator('a2ui-surface')
      .first()
      .evaluate(element => element.dataset.e2eMarker ?? null);
    if (surfaces !== 1 || marker !== 'before-refresh') {
      throw new Error(`Surface was replaced (surfaces=${surfaces}, marker=${marker})`);
    }
    await frame.locator('a2ui-vega-chart svg, a2ui-sql-data-table:visible').first().waitFor();
    return {screenshot: await screenshot(id, 'd-refreshed'), action: call.params.arguments};
  });

  await check('e. a "Break down by" button posts the templated follow-up', async () => {
    const {frame, id} = genre;
    const buttons = await frame
      .locator('a2ui-basic-button button', {hasText: 'Break down by'})
      .allTextContents();
    await frame.locator('a2ui-basic-button button', {hasText: 'Break down by'}).first().click();
    await page.waitForFunction(() => window.host.log.messages.length > 0, null, {timeout: 5000});
    const {messages} = await hostLog();
    const text = messages
      .at(-1)
      .params.content.map(block => block.text)
      .join('');
    if (!/^Break down "revenue" by "[^"]+"$/.test(text)) {
      throw new Error(`Unexpected follow-up: ${text}`);
    }
    return {
      screenshot: await screenshot(id, 'e-breakdown'),
      buttons: buttons.map(button => button.trim()),
      message: text,
    };
  });

  await check('f. a single number renders a KPI card', async () => {
    const {id, frame} = await render('query', {sql: KPI_QUERY, title: 'Total revenue'});
    await frame.locator('a2ui-card').first().waitFor();
    const value = (await frame.locator('a2ui-card').first().innerText()).replace(/\s+/g, ' ');
    if (!/2,328\.6/.test(value)) throw new Error(`KPI card shows ${value}`);
    return {screenshot: await screenshot(id, 'f-kpi'), card: value};
  });

  const hasGeminiKey = Boolean(process.env['GEMINI_API_KEY']?.trim()) || envFileHasKey();
  if (hasGeminiKey) {
    await check('h. explain renders a model-composed view', async () => {
      const explainStarted = Date.now();
      const {id, frame, result} = await render('explain', {
        question: 'Show the top 5 artists by revenue with a chart',
      });
      const explainMs = Date.now() - explainStarted;
      if (result.isError || !result.structuredContent) {
        throw new Error(`explain returned no view: ${result.content?.[0]?.text}`);
      }
      await frame.locator('a2ui-surface').first().waitFor();
      const charts = await frame.locator('a2ui-vega-chart').count();
      if (process.env['A2UI_E2E_DEBUG']) {
        const html = await frame.locator('body').evaluate(body => {
          const walk = node =>
            (node.shadowRoot ? `<#shadow ${walk(node.shadowRoot)}>` : '') +
            [...node.childNodes]
              .map(child =>
                child.nodeType === 1
                  ? `<${child.localName}>${walk(child)}`
                  : (child.textContent ?? '').trim(),
              )
              .join('');
          return walk(body).slice(0, 4000);
        });
        console.log('DEBUG explain frame:', html);
      }
      if (charts > 0) await frame.locator('a2ui-vega-chart svg').first().waitFor({timeout: 10000});
      await sleep(1000);
      const text = result.content.map(block => block.text).join('\n');
      const layout = text.includes('default layout was used') ? 'fallback' : 'model';
      if (layout !== 'model') throw new Error(`explain fell back to the default layout: ${text}`);
      const components = result.structuredContent.a2ui.messages
        .flatMap(message => message.updateComponents?.components ?? [])
        .map(component => component.component);
      if (!/Shown to the user as a \w* ?chart/.test(text) && charts > 0) {
        throw new Error(`The summary does not describe the composed chart: ${text}`);
      }
      const explainShot = await screenshot(id, 'h-explain');

      // Refresh keeps the composed components and only updates the data.
      const refresh = frame.locator('a2ui-basic-button button', {hasText: 'Refresh'});
      let refreshed = 'no Refresh button';
      if ((await refresh.count()) > 0) {
        await frame.locator('a2ui-surface *').evaluateAll(elements => {
          for (const element of elements) element.dataset.e2eMarker = 'before-refresh';
        });
        const callsBefore = (await hostLog()).toolCalls.length;
        await refresh.first().click();
        await page.waitForFunction(count => window.host.log.toolCalls.length > count, callsBefore);
        await sleep(1000);
        const call = (await hostLog()).toolCalls.at(-1);
        if (call.params.arguments.context?.layout !== 'composed') {
          throw new Error(
            `Refresh context is not composed: ${JSON.stringify(call.params.arguments)}`,
          );
        }
        const kept = await frame
          .locator('a2ui-vega-chart, a2ui-tabs, a2ui-sql-data-table')
          .evaluateAll(elements => elements.map(element => element.dataset.e2eMarker ?? 'new'));
        if (kept.length === 0 || kept.some(marker => marker !== 'before-refresh')) {
          throw new Error(`Refresh replaced the composed components: ${JSON.stringify(kept)}`);
        }
        if (charts > 0) await frame.locator('a2ui-vega-chart svg').first().waitFor();
        refreshed = `kept ${kept.length} composed elements`;
      }
      return {
        screenshot: [explainShot, await screenshot(id, 'h-explain-refreshed')],
        refreshed,
        layout,
        latencyMs: explainMs,
        components: [...new Set(components)],
        charts,
        summary: text.slice(0, 300),
      };
    });
  } else {
    report.checks.push({
      name: 'h. explain renders a model-composed view',
      status: 'skip',
      note: 'GEMINI_API_KEY is not set (environment or .env)',
    });
  }

  await check('i. no CSP violations and no A2UI in tool result text', async () => {
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
    if (violations.length > 0 || refused.length > 0 || leaking.length > 0) {
      throw new Error(
        `violations=${JSON.stringify(violations)} refused=${JSON.stringify(refused)} leaking=${JSON.stringify(leaking)}`,
      );
    }
    return {frames: page.frames().length - 1, toolResults: report.toolResults.length};
  });

  const {sizes} = await hostLog();
  for (const {frame, params} of sizes) {
    (report.frameHeights[frame] ??= []).push(params.height);
  }
  report.maxStructuredContentBytes = Math.max(
    ...report.toolResults.map(result => result.structuredContentBytes),
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

function envFileHasKey() {
  const result = spawnSync('grep', ['-Eq', '^GEMINI_API_KEY=.+', join(packageRoot, '.env')]);
  return result.status === 0;
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
console.log(`Frame heights: ${JSON.stringify(report.frameHeights)}`);
console.log(`Report: ${join(outDir, 'report.json')}`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
