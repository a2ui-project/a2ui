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
 * End-to-end Playwright verification for `a2ui-embed-redline`.
 *
 * Mounts the built MCP App inside a cross-origin sandboxed iframe under the
 * default MCP Apps CSP (`default-src 'none'`, `connect-src 'none'`), connected
 * to the real stdio MCP server, and verifies:
 * 1. Light & dark host themes, natural height <= 800 px (and <= 700 px target).
 * 2. Live client-side stance flipping updating `ClauseRedline`, `ExposureMeter`,
 *    `LeverageGauge`, and `CounterLetterPreview` with 0 server round-trips.
 * 3. `ui/update-model-context` synchronization (< 12 KiB).
 * 4. `a2ui_action` (`finalize_counter`, `reset_picks`) and `followUp`
 *    (`ask_clause_strategy` via `ui/message`).
 * 5. Multi-scenario agent composability (`apartment_lease`, `contractor_quote`,
 *    `freelance_agreement`) producing genuinely distinct component trees.
 * 6. Zero CSP violations, zero console errors, and zero A2UI leaks in tool text.
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
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/proto-redline/e2e';
const screenshotTarget = process.env['A2UI_SCREENSHOT_PATH'];

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

  const client = new Client({name: 'a2ui-embed-redline-e2e', version: '0.1.0'});
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
      text: text.slice(0, 260),
    });
    return result;
  }

  const {contents} = await client.readResource({uri: APP_URI});
  const appHtml = contents[0].text;
  const csp = appCsp(contents[0]._meta?.ui?.csp?.resourceDomains ?? []);
  report.csp = csp;
  report.appHtmlBytes = Buffer.byteLength(appHtml);

  const appServer = createServer((req, res) => {
    if (req.url !== '/app.html') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
    });
    res.end(appHtml);
  });
  const appUrl = `http://localhost:${await listen(appServer, '127.0.0.1')}/app.html`;

  const hostScript = await bundleHost();
  const hostServer = createServer((req, res) => {
    if (req.url === '/host.js') {
      res.writeHead(200, {'Content-Type': 'text/javascript'}).end(hostScript);
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Redline Negotiator Showcase</title>' +
        '<style>body{font-family:system-ui,sans-serif;margin:16px;background:#f1f4f9}h2{font-size:12px;color:#5f6368;margin:0 0 6px}</style>' +
        '</head><body><script type="module" src="/host.js"></script></body></html>',
    );
  });
  const hostUrl = `http://127.0.0.1:${await listen(hostServer, '127.0.0.1')}/`;

  const executablePath = process.env['A2UI_E2E_CHROME'];
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  const context = await browser.newContext({
    viewport: {width: 820, height: 900},
    deviceScaleFactor: 2,
  });
  await context.addInitScript(CSP_RECORDER);
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text());
    if (msg.type() === 'warning') report.consoleWarnings.push(msg.text());
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
    await new Promise(resolve => setTimeout(resolve, 500));
    const {sizes} = await hostLog();
    const last = sizes.filter(entry => entry.frame === id).at(-1);
    const height = last?.params?.height ?? 0;
    report.naturalHeights[label] = height;
    if (height <= 0 || height > 700) {
      throw new Error(`Frame ${label} height ${height}px is outside (0, 700]`);
    }
    return height;
  }

  async function waitForLog(kind, predicate, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const entries = (await hostLog())[kind];
      const found = entries.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`Timed out waiting for ${kind} log entry`);
  }

  async function screenshotFrame(id, name) {
    const target = join(outDir, `${name}.png`);
    const locator = page.locator(`#${id}`);
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({path: target});
    return target;
  }

  async function check(name, fn) {
    const started = Date.now();
    try {
      const details = await fn();
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

  let leaseCard;
  await check(
    'a. apartment_lease renders custom catalog in light theme with height <= 800 px',
    async () => {
      leaseCard = await render('redline_negotiator', {
        prompt: 'Review apartment lease with 2.5x security deposit and 10% late fee',
        scenario: 'apartment_lease',
      });
      const {frame, id} = leaseCard;
      await frame.getByRole('heading', {name: '245 Valencia St Apt 4B — 12-Month Lease'}).waitFor();
      await frame.getByText('1.0 mo norm').waitFor();
      await frame.getByText('2.5 mo theirs').waitFor();
      // apartment_lease omits MilestoneScheduleBar.
      const milestoneCount = await frame.locator('[data-testid="milestone-schedule"]').count();
      if (milestoneCount !== 0) {
        throw new Error(
          `Expected 0 MilestoneScheduleBar in apartment_lease, got ${milestoneCount}`,
        );
      }
      const height = await recordNaturalHeight(id, 'apartment_lease (light)');
      const shot = await screenshotFrame(id, 'a-lease-light');
      if (screenshotTarget) {
        await page.locator(`#${id}`).screenshot({path: screenshotTarget});
      }
      return {height, screenshot: shot};
    },
  );

  await check(
    'b. flipping stance pills updates ExposureMeter, LeverageGauge, CounterLetterPreview, and modelContext with 0 round-trips',
    async () => {
      const {frame, id} = leaseCard;
      const beforeToolCalls = (await hostLog()).toolCalls.length;
      const initialExposure = await frame.getByTestId('exposure-current').innerText();
      if (initialExposure !== '$920') {
        throw new Error(`Expected initial exposure $920, got ${initialExposure}`);
      }

      // Flip deposit and late_fee to Accept -> exposure rises to $7,400, friction drops to Low!
      await frame.locator('[data-clause-id="deposit"] [data-stance-pill="accept"]').click();
      await frame.locator('[data-clause-id="late_fee"] [data-stance-pill="accept"]').click();

      await frame.getByText('$7,400').waitFor();
      const lowVerdict = await frame.getByTestId('leverage-verdict').innerText();
      if (!lowVerdict.includes('Low friction')) {
        throw new Error(`Expected Low friction verdict, got ${lowVerdict}`);
      }

      // Flip all 3 clauses to Counter -> exposure drops to $120, friction shifts to Over-pushed!
      await frame.locator('[data-clause-id="deposit"] [data-stance-pill="counter"]').click();
      await frame.locator('[data-clause-id="late_fee"] [data-stance-pill="counter"]').click();
      await frame.locator('[data-clause-id="renewal_notice"] [data-stance-pill="counter"]').click();

      await frame.getByText('$120').first().waitFor();
      const highVerdict = await frame.getByTestId('leverage-verdict').innerText();
      if (!highVerdict.includes('Over-pushed')) {
        throw new Error(`Expected Over-pushed verdict, got ${highVerdict}`);
      }

      // Switch tone pill to Firm -> live email body updates immediately!
      await frame.locator('[data-tone-pill="firm"]').click();
      const emailText = await frame.getByTestId('counter-email-body').innerText();
      if (
        !emailText.includes('Subject: Requested redlines') ||
        !emailText.includes('initial 12-month term')
      ) {
        throw new Error(`Unexpected live firm email body: ${emailText}`);
      }

      // Confirm ZERO server tool calls happened during all stance & tone flips!
      const afterToolCalls = (await hostLog()).toolCalls.length;
      if (afterToolCalls !== beforeToolCalls) {
        throw new Error(`Expected 0 server round-trips, got ${afterToolCalls - beforeToolCalls}`);
      }

      // Verify ui/update-model-context captured updated stances & firm tone (< 12 KiB).
      const ctxEntry = await waitForLog('modelContexts', entry => {
        const txt = entry.params?.content?.[0]?.text ?? '';
        return (
          entry.frame === id &&
          txt.includes('"renewal_notice":"counter"') &&
          txt.includes('"tone":"firm"')
        );
      });
      const ctxBytes = Buffer.byteLength(ctxEntry.params.content[0].text);
      if (ctxBytes > 12 * 1024) {
        throw new Error(`Model context exceeded 12 KiB: ${ctxBytes} bytes`);
      }

      return {
        roundTrips: afterToolCalls - beforeToolCalls,
        modelContextBytes: ctxBytes,
        screenshot: await screenshotFrame(id, 'b-lease-flipped'),
      };
    },
  );

  await check(
    'c. finalize_counter, reset_picks (a2ui_action), and ask_clause_strategy (followUp via ui/message)',
    async () => {
      const {frame, id} = leaseCard;
      await frame.getByRole('button', {name: 'Lock Counter-Offer', exact: true}).click();
      const banner = frame.getByTestId('status-banner');
      await banner.waitFor();
      const bannerText = await banner.innerText();
      if (!bannerText.includes('Counter-package locked (firm tone)')) {
        throw new Error(`Unexpected finalize banner: ${bannerText}`);
      }

      await frame.getByRole('button', {name: 'Ask Strategy in Chat', exact: true}).click();
      const msgEntry = await waitForLog('messages', entry => {
        const msgText = entry.params?.content?.[0]?.text ?? '';
        return (
          entry.frame === id && msgText.includes('walk-away fallback') && msgText.includes('"firm"')
        );
      });

      await frame.getByRole('button', {name: 'Reset Picks', exact: true}).click();
      await frame.getByText('$920').waitFor();

      return {
        followUpText: msgEntry.params.content[0].text,
        screenshot: await screenshotFrame(id, 'c-lease-actions'),
      };
    },
  );

  await check(
    'd. contractor_quote in dark theme composes MilestoneScheduleBar + standalone BenchmarkBullets',
    async () => {
      const quoteCard = await render(
        'redline_negotiator',
        {
          prompt: 'Negotiate $38,500 kitchen remodel contractor quote and milestones',
          scenario: 'contractor_quote',
        },
        'dark',
      );
      const {frame, id} = quoteCard;
      await frame
        .getByRole('heading', {name: 'Oak & Tile Builders — Kitchen Remodel Quote #Q-418'})
        .waitFor();
      await frame.getByTestId('milestone-schedule').waitFor();
      await frame.getByText('$380–$500 norm').waitFor();
      await frame.getByText('28% theirs').waitFor();
      const height = await recordNaturalHeight(id, 'contractor_quote (dark)');
      return {height, screenshot: await screenshotFrame(id, 'd-quote-dark')};
    },
  );

  await check(
    'e. freelance_agreement composes 3 ClauseRedlines + MilestoneScheduleBar within height budget',
    async () => {
      const sowCard = await render('redline_negotiator', {
        prompt: 'Review consulting SOW with uncapped indemnity and Net-60 payment',
        scenario: 'freelance_agreement',
      });
      const {frame, id} = sowCard;
      await frame
        .getByRole('heading', {name: 'Northstar Labs — Product Design & Engineering SOW'})
        .waitFor();
      await frame.getByTestId('milestone-schedule').waitFor();
      await frame.getByText('25–50% norm').waitFor();
      const height = await recordNaturalHeight(id, 'freelance_agreement (light)');
      return {height, screenshot: await screenshotFrame(id, 'e-freelance-light')};
    },
  );

  await check('f. zero CSP violations, zero console errors, zero A2UI in tool text', async () => {
    const violations = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const list = await frame.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      violations.push(...list.map(item => `${frame.name()}: ${item}`));
    }
    const leaking = report.toolResults.filter(r => r.contentHasA2ui);
    const failed = report.toolResults.filter(r => r.isError);
    if (
      violations.length > 0 ||
      report.consoleErrors.length > 0 ||
      leaking.length > 0 ||
      failed.length > 0
    ) {
      throw new Error(
        `violations=${JSON.stringify(violations)} consoleErrors=${JSON.stringify(report.consoleErrors)} leaking=${leaking.length} failed=${JSON.stringify(failed)}`,
      );
    }
    return {framesChecked: page.frames().length - 1, toolResults: report.toolResults.length};
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
  console.log(
    `${entry.status.toUpperCase().padEnd(4)} ${entry.name}${entry.error ? ` — ${entry.error}` : ''}`,
  );
}
console.log(`Natural heights: ${JSON.stringify(report.naturalHeights)}`);
console.log(`App HTML size: ${report.appHtmlBytes} bytes`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
