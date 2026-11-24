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
 * End-to-end Playwright verification for `a2ui-embed-mixer`:
 * - Launches the built MCP server (`dist/server.js`) over stdio.
 * - Serves `ui://a2ui/app.html` on a separate origin under the strict default MCP Apps CSP.
 * - Verifies light & dark themes, 0 CSP violations, natural height <= 800 px (and <= 700 px),
 *   client-side scrubbing/swapping (`PortionScrubTile`) + frontier preset clicking (`ParetoPlane2D`)
 *   updating `TargetRingCluster` live with 0 server round-trips, `ui/update-model-context`,
 *   `a2ui_action` (`snap_to_targets`, `lock_mix`), `followUp` (`build_shopping_or_action_list`),
 *   and multi-scenario agent composability (`meal_prep` vs `debt_savings` vs `training_week`).
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
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/proto-mixer/e2e';
const showcaseShotPath = process.env['A2UI_SHOWCASE_SCREENSHOT'];
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

  const client = new Client({name: 'a2ui-embed-mixer-e2e', version: '0.1.0'});
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
      '<!doctype html><html><head><meta charset="utf-8"><title>Goal Mixer MCP App Host</title>' +
        '<style>body{font-family:system-ui,sans-serif;margin:16px;background:#f1f3f6}h2{font-size:12px;color:#5f6368;margin:0 0 6px}</style>' +
        '</head><body><script type="module" src="/host.js"></script></body></html>',
    );
  });
  const hostUrl = `http://127.0.0.1:${await listen(hostServer, '127.0.0.1')}/`;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: {width: 780, height: 1180},
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

  async function render(name, args, theme = 'light', label = '') {
    const result = await callTool({name, arguments: args}, 'model');
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    const id = await page.evaluate(
      ([url, toolArgs, toolResult, hostTheme, frameLabel]) =>
        window.host.render(url, toolArgs, toolResult, hostTheme, frameLabel),
      [appUrl, args, result, theme, label],
    );
    const frame = page.frameLocator(`#${id}`);
    return {id, frame, result};
  }

  async function hostLog() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.host.log)));
  }

  async function recordNaturalHeight(id, view) {
    await new Promise(resolve => setTimeout(resolve, 450));
    const {sizes} = await hostLog();
    const last = sizes.filter(entry => entry.frame === id).at(-1);
    report.naturalHeights[view] = last?.params.height;
    return last?.params.height ?? 0;
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
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.locator(`#${id}`).screenshot({path: target});
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

  let mealCard;
  await check('a. meal_prep renders custom catalog in light theme within <= 700 px', async () => {
    mealCard = await render(
      'goal_mixer',
      {prompt: 'High-protein weekday meal prep under $65/wk and 15m prep'},
      'light',
      'Meal Prep Studio',
    );
    const {frame, id} = mealCard;
    await frame.getByText('1,850 kcal', {exact: true}).waitFor({timeout: 15_000});
    await frame.getByText('145g protein', {exact: true}).waitFor();
    await frame.getByText('$62/wk', {exact: true}).waitFor();
    await frame.getByText('14m prep', {exact: true}).waitFor();
    await frame.getByText('4/4 targets converged').waitFor();

    const height = await recordNaturalHeight(id, 'meal_prep_light');
    if (height <= 0 || height > 700) {
      throw new Error(`meal_prep height ${height}px exceeded 700px natural card height budget`);
    }
    const shot = await screenshotFrame(id, 'a-meal-prep-light');
    if (showcaseShotPath) {
      await page.locator(`#${id}`).screenshot({path: showcaseShotPath});
    }
    return {height, screenshot: shot};
  });

  await check(
    'b. scrubbing/swapping PortionScrubTile + clicking ParetoPlane2D update rings live with 0 server round-trips + model context',
    async () => {
      const {frame, id} = mealCard;
      const beforeCalls = (await hostLog()).toolCalls.length;

      // 1. Swap Greek yogurt -> Tofu on Breakfast anchor
      await frame
        .locator('.scrub-tile[data-item-id="breakfast"] button[data-option-id="tofu"]')
        .click();
      await frame.getByText('1,840 kcal', {exact: true}).waitFor({timeout: 5000});
      await frame.getByText('18m prep', {exact: true}).waitFor({timeout: 5000});
      await frame.getByText('3/4 targets in band').waitFor({timeout: 5000});

      // 2. Scrub Main protein batch up with '+' stepper (1.0x -> 1.25x)
      await frame.getByRole('button', {name: 'Increase Main protein batch'}).click();
      await frame.getByText('1.25x', {exact: true}).waitFor({timeout: 5000});

      // 3. Click ParetoPlane2D frontier preset dot "$44 Plant Saver" directly in SVG
      await frame.locator('g.pareto-plane__node[data-preset-id="preset_plant_budget"]').click();
      await frame.getByText('$44/wk', {exact: true}).waitFor({timeout: 5000});

      const afterCalls = (await hostLog()).toolCalls.length;
      if (afterCalls !== beforeCalls) {
        throw new Error(
          `Expected 0 server round-trips during client edits, saw ${afterCalls - beforeCalls}`,
        );
      }

      // Verify ui/update-model-context captured the live updated data model (< 12 KiB)
      const ctxEntry = await waitForLog('modelContexts', entry => {
        const txt = entry.params.content?.[0]?.text ?? '';
        return entry.frame === id && txt.includes('preset_plant_budget');
      });
      const ctxBytes = Buffer.byteLength(ctxEntry.params.content[0].text);
      if (ctxBytes > 12 * 1024) {
        throw new Error(`Model context ${ctxBytes} bytes exceeded 12 KiB`);
      }

      return {
        roundTrips: afterCalls - beforeCalls,
        modelContextBytes: ctxBytes,
        screenshot: await screenshotFrame(id, 'b-live-pareto-and-scrub'),
      };
    },
  );

  await check(
    'c. CommitBar dispatches snap_to_targets, lock_mix, and followUp build_shopping_or_action_list',
    async () => {
      const {frame, id} = mealCard;

      await frame.getByRole('button', {name: 'Snap to targets', exact: true}).click();
      await frame.getByText('4/4 targets converged').waitFor({timeout: 10_000});
      await frame.getByText('$62/wk', {exact: true}).waitFor({timeout: 10_000});

      await frame.getByRole('button', {name: 'Lock mix', exact: true}).click();
      await frame
        .getByRole('button', {name: '✓ Mix locked', exact: true})
        .waitFor({timeout: 10_000});

      await frame.getByRole('button', {name: 'Shopping list ↗', exact: true}).click();
      const followUp = await waitForLog(
        'messages',
        entry =>
          entry.frame === id &&
          JSON.stringify(entry.params).includes('grocery shopping & 45-min Sunday batch checklist'),
      );

      return {
        followUp: followUp.params.content[0].text,
        screenshot: await screenshotFrame(id, 'c-snapped-and-locked'),
      };
    },
  );

  await check(
    'd. dark theme + multi-scenario composition (debt_savings & training_week)',
    async () => {
      const debt = await render(
        'goal_mixer',
        {
          prompt:
            'Balance $1,500 monthly surplus between high-APR debt payoff and emergency savings cushion',
        },
        'dark',
        'Debt vs Savings (Dark)',
      );
      await debt.frame.getByText('$320/mo', {exact: true}).waitFor({timeout: 15_000});
      await debt.frame.getByText('13 mos', {exact: true}).waitFor();
      const debtGanttCount = await debt.frame.locator('a2ui-prep-track-gantt').count();
      const debtParetoCount = await debt.frame.locator('a2ui-pareto-plane-2d').count();
      if (debtGanttCount !== 0 || debtParetoCount !== 1) {
        throw new Error(
          `debt_savings composition mismatch: gantt=${debtGanttCount}, pareto=${debtParetoCount}`,
        );
      }
      const debtHeight = await recordNaturalHeight(debt.id, 'debt_savings_dark');
      if (debtHeight > 800) throw new Error(`debt_savings height ${debtHeight}px > 800px`);

      const train = await render(
        'goal_mixer',
        {prompt: 'Balance weekly Zone 2 endurance, strength lifts, and recovery readiness'},
        'light',
        'Hybrid Training Week',
      );
      await train.frame.getByText('165m/wk', {exact: true}).waitFor({timeout: 15_000});
      const trainGanttCount = await train.frame.locator('a2ui-prep-track-gantt').count();
      const trainParetoCount = await train.frame.locator('a2ui-pareto-plane-2d').count();
      if (trainGanttCount !== 1 || trainParetoCount !== 0) {
        throw new Error(
          `training_week composition mismatch: gantt=${trainGanttCount}, pareto=${trainParetoCount}`,
        );
      }
      const trainHeight = await recordNaturalHeight(train.id, 'training_week_light');
      if (trainHeight > 800) throw new Error(`training_week height ${trainHeight}px > 800px`);

      return {
        debtHeight,
        trainHeight,
        screenshot: [
          await screenshotFrame(debt.id, 'd-debt-savings-dark'),
          await screenshotFrame(train.id, 'd-training-week-light'),
        ],
      };
    },
  );

  await check('e. zero CSP violations, zero console errors, zero A2UI text leaks', async () => {
    const violations = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const list = await frame.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      violations.push(...list.map(entry => `${frame.name()}: ${entry}`));
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
        `violations=${JSON.stringify(violations)} consoleErrors=${JSON.stringify(report.consoleErrors)} leaking=${leaking.length} failed=${failed.length}`,
      );
    }
    return {frames: page.frames().length - 1, toolResults: report.toolResults.length};
  });

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
  console.log(
    `${entry.status.toUpperCase().padEnd(4)} ${entry.name}${entry.error ? ` — ${entry.error}` : ''}`,
  );
}
console.log(`Natural heights: ${JSON.stringify(report.naturalHeights)}`);
console.log(`Console errors: ${report.consoleErrors.length}`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
