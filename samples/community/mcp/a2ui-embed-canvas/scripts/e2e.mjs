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
 * End-to-end Playwright harness for Space & Seating Planner (`a2ui-embed-canvas`).
 * Renders the custom spatial/seating catalog inside a cross-origin sandboxed
 * iframe under the default MCP Apps CSP (`default-src 'none'`) connected to the
 * stdio MCP server.
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
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/a2ui-embed-canvas-e2e';
const screenshotTarget = process.env['A2UI_E2E_SCREENSHOT'];
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

  const client = new Client({name: 'a2ui-embed-canvas-e2e', version: '0.0.0'});
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
      '<!doctype html><html><head><meta charset="utf-8"><title>Space & Seating Planner Host</title>' +
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

  let bedroomCard;
  let seatingCard;
  let patioCard;

  await check(
    'a. bedroom_office renders PresetStrip, CanvasSplit(PlanCanvas, SelectionInspector[PieceTray]), and RuleScoreboard within height cap',
    async () => {
      bedroomCard = await render('space_planner', {
        prompt:
          'Can a queen bed and 60-inch standing desk fit in my bedroom without blocking the door swing?',
      });
      const {frame, id} = bedroomCard;
      await frame.getByText('Bedroom + Standing Desk Fit').waitFor({timeout: 15_000});
      await frame.locator('a2ui-canvas-preset-strip').waitFor();
      await frame.locator('a2ui-canvas-plan-canvas').waitFor();
      await frame.locator('a2ui-canvas-selection-inspector a2ui-canvas-piece-tray').waitFor();
      await frame.locator('a2ui-canvas-rule-scoreboard').waitFor();
      await frame.locator('[data-rule-id="r_door"][data-status="fail"]').waitFor();
      const height = await recordNaturalHeight(id, 'bedroom_office (light)');

      const windowShot = screenshotTarget ?? join(outDir, 'window-canvas-studio.png');
      await page.screenshot({path: windowShot});
      const frameShot = await screenshotFrame(id, 'a-bedroom-office-light');
      return {height, screenshot: [windowShot, frameShot]};
    },
  );

  await check(
    'b. dinner_seating and patio_garden compose genuinely distinct component trees within height cap',
    async () => {
      seatingCard = await render('space_planner', {
        prompt: 'Seat 16 dinner guests across 2 round tables keeping Maya away from Dan',
      });
      await seatingCard.frame
        .getByText('16-Guest Harvest Dinner Seating')
        .waitFor({timeout: 15_000});
      await seatingCard.frame.locator('a2ui-canvas-rule-scoreboard').waitFor();
      await seatingCard.frame.locator('a2ui-canvas-preset-strip').waitFor();
      await seatingCard.frame.locator('a2ui-canvas-plan-canvas').waitFor();
      if ((await seatingCard.frame.locator('a2ui-canvas-piece-tray').count()) !== 0) {
        throw new Error('dinner_seating unexpectedly rendered PieceTray');
      }
      if ((await seatingCard.frame.locator('a2ui-canvas-selection-inspector').count()) !== 0) {
        throw new Error('dinner_seating unexpectedly rendered SelectionInspector');
      }
      const seatingHeight = await recordNaturalHeight(seatingCard.id, 'dinner_seating (light)');

      patioCard = await render('space_planner', {
        prompt: 'Arrange a courtyard patio around a fire pit and pergola shade',
        scenario: 'patio_garden',
      });
      await patioCard.frame.getByText('Courtyard Patio & Fire Pit').waitFor({timeout: 15_000});
      await patioCard.frame.locator('a2ui-canvas-selection-inspector').waitFor();
      await patioCard.frame.locator('a2ui-canvas-piece-tray').waitFor();
      if ((await patioCard.frame.locator('a2ui-canvas-preset-strip').count()) !== 0) {
        throw new Error('patio_garden unexpectedly rendered PresetStrip');
      }
      const patioHeight = await recordNaturalHeight(patioCard.id, 'patio_garden (light)');

      return {
        seatingHeight,
        patioHeight,
        screenshot: [
          await screenshotFrame(seatingCard.id, 'b-dinner-seating-light'),
          await screenshotFrame(patioCard.id, 'b-patio-garden-light'),
        ],
      };
    },
  );

  await check('c. dark theme renders cleanly from host context', async () => {
    const darkBedroom = await render(
      'space_planner',
      {scenario: 'bedroom_office', prompt: 'Bedroom office in dark theme'},
      'dark',
    );
    await darkBedroom.frame.getByText('Bedroom + Standing Desk Fit').waitFor({timeout: 15_000});
    const darkBedroomHeight = await recordNaturalHeight(darkBedroom.id, 'bedroom_office (dark)');

    const darkSeating = await render(
      'space_planner',
      {scenario: 'dinner_seating', prompt: 'Dinner seating in dark theme'},
      'dark',
    );
    await darkSeating.frame.getByText('16-Guest Harvest Dinner Seating').waitFor({timeout: 15_000});
    const darkSeatingHeight = await recordNaturalHeight(darkSeating.id, 'dinner_seating (dark)');

    return {
      darkBedroomHeight,
      darkSeatingHeight,
      screenshot: [
        await screenshotFrame(darkBedroom.id, 'c-bedroom-office-dark'),
        await screenshotFrame(darkSeating.id, 'c-dinner-seating-dark'),
      ],
    };
  });

  await check(
    'd. client-side PlanCanvas drag/swap, PresetStrip, and PieceTray reactively update RuleScoreboard & model context with 0 server round-trips',
    async () => {
      // 1. Bedroom floorplan: drag standing desk upward out of door swing, apply preset, and toggle crib in PieceTray
      await page.locator(`#${bedroomCard.id}`).scrollIntoViewIfNeeded();
      const bFrame = bedroomCard.frame;
      const beforeBedroomCalls = await actionCallCount(bedroomCard.id);

      const deskGroup = bFrame.locator('[data-piece-id="desk_active"]');
      const deskBox = await deskGroup.boundingBox();
      if (!deskBox) throw new Error('desk_active boundingBox unavailable');
      await page.mouse.move(deskBox.x + deskBox.width / 2, deskBox.y + deskBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        deskBox.x + deskBox.width / 2 - 16,
        deskBox.y + deskBox.height / 2 - 108,
        {steps: 8},
      );
      await page.mouse.up();
      await bFrame.locator('[data-rule-id="r_door"][data-status="pass"]').waitFor({timeout: 5_000});

      await bFrame.getByRole('button', {name: /Daylight Studio/}).click();
      await bFrame
        .locator('[data-rule-id="r_outlet"][data-status="pass"]')
        .waitFor({timeout: 5_000});

      await bFrame.getByRole('button', {name: /Crib \(28×52\)/}).click();
      await bFrame.locator('[data-piece-id="crib_mini"]').waitFor({timeout: 5_000});

      if ((await actionCallCount(bedroomCard.id)) !== beforeBedroomCalls) {
        throw new Error('Client-side floorplan/preset/tray edit unexpectedly called the server');
      }

      // 2. Banquet seating: click-two-seats swap (Dan <-> Tariq) flips Maya away from Dan to pass
      await page.locator(`#${seatingCard.id}`).scrollIntoViewIfNeeded();
      const sFrame = seatingCard.frame;
      const beforeSeatingCalls = await actionCallCount(seatingCard.id);
      await sFrame.locator('[data-rule-id="s_maya_dan"][data-status="fail"]').waitFor();
      await sFrame.getByRole('button', {name: 'Seat Dan', exact: true}).click();
      await sFrame.getByRole('button', {name: 'Seat Tariq', exact: true}).click();
      await sFrame
        .locator('[data-rule-id="s_maya_dan"][data-status="pass"]')
        .waitFor({timeout: 5_000});

      if ((await actionCallCount(seatingCard.id)) !== beforeSeatingCalls) {
        throw new Error('Client-side seat swap unexpectedly called the server');
      }

      const ctxEntry = await waitForLog('modelContexts', entry => {
        const text = entry.params?.content?.[0]?.text ?? '';
        return entry.frame === bedroomCard.id && text.includes('crib_mini');
      });
      const contextBytes = Buffer.byteLength(ctxEntry.params.content[0].text);
      if (contextBytes > 12 * 1024) {
        throw new Error(`Model context exceeded 12 KiB (${contextBytes} bytes)`);
      }

      return {
        contextBytes,
        screenshot: [
          await screenshotFrame(bedroomCard.id, 'd-bedroom-edited'),
          await screenshotFrame(seatingCard.id, 'd-seating-swapped'),
        ],
      };
    },
  );

  await check(
    'e. PlanActionBar dispatches ask_ergonomics_or_hosts followUp and in-place auto_resolve_conflicts & save_layout actions',
    async () => {
      const {frame, id} = patioCard;
      const framesBefore = await page.locator('iframe').count();

      await frame.getByRole('button', {name: 'Ask shade & planting tips', exact: true}).click();
      const followUpMsg = await waitForLog(
        'messages',
        entry =>
          entry.frame === id &&
          JSON.stringify(entry.params).includes('Courtyard Patio & Fire Pit') &&
          JSON.stringify(entry.params).includes('Smokeless Fire Pit'),
      );

      await frame.locator('[data-rule-id="p_fire"][data-status="fail"]').waitFor();
      await frame.getByRole('button', {name: 'Auto-resolve fire halo', exact: true}).click();
      await frame.locator('[data-rule-id="p_fire"][data-status="pass"]').waitFor({timeout: 10_000});
      await frame.getByText(/Resolved ✓ · 100%/).waitFor({timeout: 5_000});

      await frame.getByRole('button', {name: 'Save patio plan', exact: true}).click();
      await frame.getByText(/Saved ✓ · 100%/).waitFor({timeout: 10_000});

      const framesAfter = await page.locator('iframe').count();
      if (framesAfter !== framesBefore) {
        throw new Error('In-place action unexpectedly spawned a new frame');
      }

      return {
        followUp: followUpMsg.params.content[0].text,
        screenshot: await screenshotFrame(id, 'e-patio-resolved-saved'),
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
