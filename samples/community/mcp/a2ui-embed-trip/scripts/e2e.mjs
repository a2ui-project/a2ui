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
 * End-to-end Playwright harness for Day & Trip Studio (`a2ui-embed-trip`).
 * Renders the custom catalog inside a cross-origin sandboxed iframe under the
 * default MCP Apps CSP (`default-src 'none'`) connected to the stdio MCP server.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/a2ui-embed-trip-e2e';
const APP_URI = 'ui://a2ui/app.html';
const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;

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

async function run() {
  mkdirSync(outDir, {recursive: true});
  const report = {
    checks: [],
    toolResults: [],
    naturalHeights: {},
    consoleErrors: [],
    consoleWarnings: [],
  };

  const client = new Client({name: 'a2ui-embed-trip-e2e', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--preserve-symlinks', join(packageRoot, 'dist', 'server.js')],
      env: {...process.env},
      stderr: 'inherit',
    }),
  );

  async function callTool(params, source) {
    const result = await client.callTool(params, undefined, {timeout: 30_000});
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
    });
    return result;
  }

  const {contents} = await client.readResource({uri: APP_URI});
  const appHtml = contents[0].text;
  const csp = appCsp(contents[0]._meta?.ui?.csp?.resourceDomains ?? []);
  report.csp = csp;
  report.appHtmlBytes = Buffer.byteLength(appHtml);

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

  const hostScript = await bundleHost();
  const hostServer = createServer((request, response) => {
    if (request.url === '/host.js') {
      response.writeHead(200, {'Content-Type': 'text/javascript'}).end(hostScript);
      return;
    }
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Day & Trip Studio Host</title>' +
        '<style>body{font-family:system-ui,sans-serif;margin:18px;background:#f1f4f9}</style>' +
        '</head><body><script type="module" src="/host.js"></script></body></html>',
    );
  });
  const hostUrl = `http://127.0.0.1:${await listen(hostServer, '127.0.0.1')}/`;

  const executablePath = process.env['A2UI_E2E_CHROME'];
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  const context = await browser.newContext({viewport: {width: 780, height: 700}});
  await context.addInitScript(CSP_RECORDER);
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
    if (message.type() === 'warning') report.consoleWarnings.push(message.text());
  });
  await page.exposeFunction('harnessCallTool', params => callTool(params, 'app'));
  await page.goto(hostUrl);
  await page.waitForFunction(() => window.host !== undefined);

  async function render(name, args, theme = 'light') {
    const result = await callTool({name, arguments: args}, 'model');
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    const id = await page.evaluate(
      ([url, toolArgs, toolResult, hostTheme]) =>
        window.host.render(url, toolArgs, toolResult, hostTheme),
      [appUrl, args, result, theme],
    );
    const frame = page.frameLocator(`#${id}`);
    return {id, frame, result};
  }

  async function hostLog() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.host.log)));
  }

  async function recordNaturalHeight(id, label) {
    await new Promise(resolve => setTimeout(resolve, 450));
    const {sizes} = await hostLog();
    const last = sizes.filter(entry => entry.frame === id).at(-1);
    const h = last?.params?.height ?? 0;
    report.naturalHeights[label] = h;
    if (h <= 0 || h > 800) {
      throw new Error(`Frame ${label} height ${h}px out of bounds (expected 1..800px)`);
    }
    return h;
  }

  async function screenshotFrame(id, name) {
    const file = join(outDir, `${name}.png`);
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.locator(`#${id}`).screenshot({path: file});
    return file;
  }

  async function waitForLog(kind, predicate, timeout = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const entries = (await hostLog())[kind];
      const found = entries.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`No ${kind} log entry matched within ${timeout} ms`);
  }

  async function actionCallCount(frameId) {
    const {toolCalls} = await hostLog();
    return toolCalls.filter(c => c.frame === frameId).length;
  }

  async function check(name, body) {
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

  let gapCard;
  let budgetCard;

  await check(
    'a. afternoon_gap renders custom weather, timeline+slotted swap deck, and minimap within height cap',
    async () => {
      gapCard = await render('trip_studio', {
        prompt:
          'Squeeze a museum and coffee between 2pm hotel check-in and 7pm dinner, watching rain and walking time',
      });
      const {frame, id} = gapCard;
      await frame.getByText('Kyoto Afternoon Gap Studio').waitFor({timeout: 15_000});
      await frame.locator('a2ui-trip-weather-ribbon').waitFor();
      await frame.locator('a2ui-trip-timeline-strip a2ui-trip-swap-deck').waitFor();
      await frame.locator('a2ui-trip-route-minimap').waitFor();
      if ((await frame.locator('a2ui-trip-budget-split-bar').count()) !== 0) {
        throw new Error('afternoon_gap unexpectedly rendered BudgetSplitBar');
      }
      const height = await recordNaturalHeight(id, 'afternoon_gap (light)');
      // Capture full-window screenshot of the primary rendered studio card before appending more frames.
      const windowShot = join(outDir, 'window-trip-studio.png');
      await page.screenshot({path: windowShot});
      const frameShot = await screenshotFrame(id, 'a-afternoon-gap-light');
      return {height, screenshot: [windowShot, frameShot]};
    },
  );

  await check(
    'b. weekend_budget and rainy_family compose distinct component trees within height cap',
    async () => {
      budgetCard = await render('trip_studio', {
        prompt: 'Plan a weekend trip under $650 in Trip Studio comparing 3 neighborhood hotels',
      });
      await budgetCard.frame.getByText('Lisbon Weekend Budget Studio').waitFor({timeout: 15_000});
      await budgetCard.frame.locator('a2ui-trip-budget-split-bar').waitFor();
      await budgetCard.frame.locator('a2ui-trip-swap-deck').waitFor();
      if ((await budgetCard.frame.locator('a2ui-trip-weather-ribbon').count()) !== 0) {
        throw new Error('weekend_budget unexpectedly rendered WeatherRibbon');
      }
      const budgetHeight = await recordNaturalHeight(budgetCard.id, 'weekend_budget (light)');

      const familyCard = await render('trip_studio', {
        prompt: 'Stroller-friendly rainy day with kids and indoor science backups',
        scenario: 'rainy_family',
      });
      await familyCard.frame.getByText('Vancouver Rainy Family Day').waitFor({timeout: 15_000});
      await familyCard.frame.locator('a2ui-trip-weather-ribbon').waitFor();
      await familyCard.frame.locator('a2ui-trip-budget-split-bar').waitFor();
      const familyHeight = await recordNaturalHeight(familyCard.id, 'rainy_family (light)');

      return {
        budgetHeight,
        familyHeight,
        screenshot: [
          await screenshotFrame(budgetCard.id, 'b-weekend-budget-light'),
          await screenshotFrame(familyCard.id, 'b-rainy-family-light'),
        ],
      };
    },
  );

  await check('c. dark theme renders cleanly from host context', async () => {
    const darkGap = await render(
      'trip_studio',
      {scenario: 'afternoon_gap', prompt: 'Afternoon gap in dark theme'},
      'dark',
    );
    await darkGap.frame.getByText('Kyoto Afternoon Gap Studio').waitFor({timeout: 15_000});
    const darkGapHeight = await recordNaturalHeight(darkGap.id, 'afternoon_gap (dark)');

    const darkBudget = await render(
      'trip_studio',
      {scenario: 'weekend_budget', prompt: 'Weekend budget under $650'},
      'dark',
    );
    await darkBudget.frame.getByText('Lisbon Weekend Budget Studio').waitFor({timeout: 15_000});
    const darkBudgetHeight = await recordNaturalHeight(darkBudget.id, 'weekend_budget (dark)');

    return {
      darkGapHeight,
      darkBudgetHeight,
      screenshot: [
        await screenshotFrame(darkGap.id, 'c-afternoon-gap-dark'),
        await screenshotFrame(darkBudget.id, 'c-weekend-budget-dark'),
      ],
    };
  });

  await check(
    'd. client-side map pin, timeline shift, and stop/hotel swaps reactively update tripStats & model context with 0 server round-trips',
    async () => {
      // 1. Hotel swap in weekend_budget updates BudgetSplitBar via tripStats without server call
      const bFrame = budgetCard.frame;
      const beforeBudgetCalls = await actionCallCount(budgetCard.id);
      await bFrame.getByText('Stay $360').waitFor();
      await bFrame.getByRole('button', {name: /Alfama Patio Guesthouse/}).click();
      await bFrame.getByText('Stay $230').waitFor({timeout: 5_000});
      if ((await actionCallCount(budgetCard.id)) !== beforeBudgetCalls) {
        throw new Error('Client-side hotel swap unexpectedly called the server');
      }

      // 2. Pin selection + time shift + stop swap in afternoon_gap
      const gFrame = gapCard.frame;
      const beforeGapCalls = await actionCallCount(gapCard.id);
      await gFrame.getByRole('button', {name: /Pin 2: Weekenders Roastery Courtyard/}).click();
      await gFrame.getByText('Smart Coffee Teramachi').waitFor({timeout: 5_000});
      await gFrame.getByRole('button', {name: '+15m', exact: true}).click();
      await gFrame.getByText('15:00–15:45').waitFor({timeout: 5_000});
      await gFrame.getByRole('button', {name: /Smart Coffee Teramachi/}).click();
      await gFrame.getByText('$136').waitFor({timeout: 5_000});
      if ((await actionCallCount(gapCard.id)) !== beforeGapCalls) {
        throw new Error('Client-side timeline/swap edit unexpectedly called the server');
      }

      const ctxEntry = await waitForLog('modelContexts', entry => {
        const text = entry.params?.content?.[0]?.text ?? '';
        return entry.frame === gapCard.id && text.includes('Smart Coffee Teramachi');
      });
      const contextBytes = Buffer.byteLength(ctxEntry.params.content[0].text);
      if (contextBytes > 12 * 1024) {
        throw new Error(`Model context exceeded 12 KiB (${contextBytes} bytes)`);
      }

      return {
        contextBytes,
        screenshot: [
          await screenshotFrame(budgetCard.id, 'd-hotel-swapped'),
          await screenshotFrame(gapCard.id, 'd-stop-swapped'),
        ],
      };
    },
  );

  await check(
    'e. ActionFooter dispatches ask_local_spots followUp and in-place rain_reschedule & lock_itinerary actions',
    async () => {
      const {frame, id} = gapCard;
      const framesBefore = await page.locator('iframe').count();

      await frame.getByRole('button', {name: 'Ask local spots', exact: true}).click();
      const followUpMsg = await waitForLog(
        'messages',
        entry =>
          entry.frame === id &&
          JSON.stringify(entry.params).includes('Smart Coffee Teramachi') &&
          JSON.stringify(entry.params).includes('Nakagyo · Gion'),
      );

      await frame.getByRole('button', {name: 'Rain reschedule', exact: true}).click();
      await frame.getByText('Rain-safe ☂').waitFor({timeout: 10_000});
      await frame.getByText('Museum of Kyoto Craft Vaults').first().waitFor({timeout: 5_000});

      await frame.getByRole('button', {name: 'Lock itinerary', exact: true}).click();
      await frame.getByText('Locked ✓').waitFor({timeout: 10_000});

      const framesAfter = await page.locator('iframe').count();
      if (framesAfter !== framesBefore) {
        throw new Error('In-place action unexpectedly spawned a new frame');
      }

      return {
        followUp: followUpMsg.params.content[0].text,
        screenshot: await screenshotFrame(id, 'e-locked-rain-safe'),
      };
    },
  );

  await check('f. zero CSP violations, console errors, or A2UI leaks in tool text', async () => {
    const violations = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const list = await frame.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      violations.push(...list.map(entry => `${frame.name()}: ${entry}`));
    }
    const refused = report.consoleErrors.filter(msg =>
      /Content Security Policy|Refused to/.test(msg),
    );
    const leaking = report.toolResults.filter(r => r.contentHasA2ui);
    const failed = report.toolResults.filter(r => r.isError);
    if (
      violations.length > 0 ||
      refused.length > 0 ||
      leaking.length > 0 ||
      failed.length > 0 ||
      report.consoleErrors.length > 0
    ) {
      throw new Error(
        `violations=${JSON.stringify(violations)} consoleErrors=${JSON.stringify(report.consoleErrors)} leaking=${leaking.length} failed=${JSON.stringify(failed)}`,
      );
    }
    return {frames: page.frames().length - 1, toolCalls: report.toolResults.length};
  });

  await browser.close();
  await client.close();
  appServer.close();
  hostServer.close();
  return report;
}

const report = await run();
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of report.checks) {
  const detail = entry.error ? ` (${entry.error})` : '';
  console.log(`${entry.status.toUpperCase().padEnd(4)} ${entry.name}${detail}`);
}
console.log(`App HTML: ${report.appHtmlBytes} bytes`);
console.log(`Natural heights: ${JSON.stringify(report.naturalHeights)}`);
console.log(`Console errors: ${report.consoleErrors.length}`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
