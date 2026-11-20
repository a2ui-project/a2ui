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
 * server over stdio in fixture mode, and runs the interactive checks. Each
 * check saves a screenshot.
 *
 * Usage: yarn build && yarn capture-fixtures && yarn e2e
 *
 * Environment:
 * - A2UI_E2E_OUT: screenshot and report directory. Optional (default: /tmp/a2ui-embed-triage-e2e).
 * - A2UI_E2E_CHROME: Chrome executable. Optional (default: Playwright's Chromium).
 * - GITHUB_FIXTURES: fixture directory. Optional (default: fixtures-local/a2ui).
 * - GEMINI_API_KEY (or the server's .env): enables the live AI suggestion step.
 * - A2UI_E2E_CHECKS: comma-separated check letters to run, such as `b,c`. Optional (default: all).
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env['A2UI_E2E_OUT'] ?? '/tmp/a2ui-embed-triage-e2e';
const fixtures = process.env['GITHUB_FIXTURES'] ?? join(packageRoot, 'fixtures-local', 'a2ui');

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
  if (process.env['GEMINI_API_KEY']) return true;
  const result = spawnSync('grep', ['-Eq', '^GEMINI_API_KEY=.+', join(packageRoot, '.env')]);
  return result.status === 0;
}

/** Runs the harness and returns the report. */
async function run() {
  mkdirSync(outDir, {recursive: true});
  const snapshot = JSON.parse(readFileSync(join(fixtures, 'snapshot.json'), 'utf8'));
  const report = {
    fixtures,
    checks: [],
    toolResults: [],
    frameHeights: {},
    consoleErrors: [],
    consoleWarnings: [],
  };

  // The real server, launched the way an MCP host launches it, in fixture mode
  // with writes disabled whatever the environment says.
  const client = new Client({name: 'a2ui-embed-github-triage-e2e', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--preserve-symlinks', join(packageRoot, 'dist', 'server.js')],
      env: {...process.env, GITHUB_FIXTURES: fixtures, TRIAGE_WRITE: '', TRIAGE_WRITE_REPOS: ''},
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
  async function render(name, args) {
    const result = await callTool({name, arguments: args}, 'model');
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    const id = await page.evaluate(
      ([url, toolArgs, toolResult]) => window.host.render(url, toolArgs, toolResult),
      [appUrl, args, result],
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

  let inbox;
  await check('a. inbox filters (in a Modal) refresh the list in place', async () => {
    inbox = await render('triage_inbox', {});
    const {frame, id} = inbox;
    await frame.locator('a2ui-triage-label-chip').first().waitFor();
    await recordNaturalHeight(id, 'triage_inbox');
    const rows = await frame.locator('a2ui-list a2ui-checkbox').count();
    const avatars = await frame.locator('a2ui-triage-avatar').count();
    const firstShot = await screenshot(id, 'a-inbox');
    const frames = await frameCount();
    const textField = dialog =>
      dialog.locator('a2ui-basic-textfield', {hasText: 'Text in title or body'}).locator('input');
    await button(frame, 'Filters…').click();
    const dialog = frame.getByRole('dialog');
    await dialog.getByText('Only untriaged (no priority label)').click();
    await textField(dialog).fill('renderer');
    await dialog.getByRole('button', {name: 'Most commented', exact: true}).click();
    const dialogShot = await screenshot(id, 'a-inbox-filters');
    await dialog.getByRole('button', {name: 'Apply filters', exact: true}).click();
    await frame
      .getByText(/: open issues, matching "renderer", sorted by most commented/)
      .first()
      .waitFor({timeout: 10_000});
    if ((await frameCount()) !== frames) throw new Error('The filter opened a new frame');
    // The list shrank; the open dialog must still fit in the frame.
    await new Promise(resolve => setTimeout(resolve, 500));
    const fit = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return {top: box.top, bottom: box.bottom, viewport: window.innerHeight};
    });
    if (fit.top < 0 || fit.bottom > fit.viewport + 1) {
      throw new Error(`The Filters dialog is clipped after Apply: ${JSON.stringify(fit)}`);
    }
    if ((await actionCalls(id, 'filter_inbox')).length !== 1) {
      throw new Error('No filter_inbox action');
    }
    await dialog.getByRole('button', {name: 'Close'}).click();
    const filtered = await frame.locator('a2ui-list a2ui-checkbox').count();
    const shot = await screenshot(id, 'a-inbox-filtered');
    // Back to the untriaged queue for the next checks.
    await button(frame, 'Filters…').click();
    await textField(dialog).fill('');
    await dialog.getByText('Only untriaged (no priority label)').click();
    await dialog.getByRole('button', {name: 'Newest', exact: true}).click();
    await dialog.getByRole('button', {name: 'Apply filters', exact: true}).click();
    await frame
      .getByText(/: untriaged open issues, sorted by newest/)
      .first()
      .waitFor({timeout: 10_000});
    await dialog.getByRole('button', {name: 'Close'}).click();
    return {screenshot: [firstShot, dialogShot, shot], rows, avatars, filteredRows: filtered};
  });

  let selectedNumbers = [];
  await check(
    'b. multi-select shares the selection, bulk Modal previews and confirms a dry run in place',
    async () => {
      const {frame, id} = inbox;
      const numbers = [...inbox.text.matchAll(/^- #(\d+)/gm)].map(match => Number(match[1]));
      selectedNumbers = numbers.slice(0, 2);
      for (const number of selectedNumbers) {
        await frame
          .locator('a2ui-checkbox', {hasText: `#${number}`})
          .locator('input')
          .check();
      }
      const context = await waitForLog(
        'modelContexts',
        entry =>
          entry.frame === id &&
          selectedNumbers.every(number =>
            JSON.stringify(entry.params).includes(`\\"number\\":${number},`),
          ) &&
          JSON.stringify(entry.params).includes('\\"selected\\":true'),
      );
      const contextText = context.params.content?.[0]?.text ?? '';
      const frames = await frameCount();
      await button(frame, 'Bulk edit selected…').click();
      const dialog = frame.getByRole('dialog');
      await dialog
        .getByText(`2 selected: #${selectedNumbers[0]}, #${selectedNumbers[1]}`)
        .waitFor();
      await dialog.getByRole('button', {name: /^P3: /}).click();
      await dialog.getByRole('button', {name: 'Confirm and apply', exact: true}).waitFor();
      const confirmDisabled = await dialog
        .getByRole('button', {name: 'Confirm and apply', exact: true})
        .isDisabled();
      await dialog.getByRole('button', {name: 'Preview changes', exact: true}).click();
      await dialog
        .getByText(/changes to 2 issues\. Confirming is a dry run/)
        .waitFor({timeout: 10_000});
      const previewText = await dialog.innerText();
      if (previewText.includes('**')) throw new Error('Bulk preview shows raw markdown');
      const previewShot = await screenshot(id, 'b-bulk-preview');
      await dialog.getByRole('button', {name: 'Confirm and apply', exact: true}).click();
      await dialog
        .getByText(/^Dry run: \d+ changes to 2 items not written/)
        .waitFor({timeout: 10_000});
      const doneShot = await screenshot(id, 'b-bulk-dry-run');
      if ((await frameCount()) !== frames) throw new Error('The bulk edit opened a new frame');
      if (!confirmDisabled) throw new Error('Confirm was enabled before the preview');
      await dialog.getByRole('button', {name: 'Close'}).click();
      return {
        screenshot: [previewShot, doneShot],
        selected: selectedNumbers,
        modelContextBytes: Buffer.byteLength(contextText),
      };
    },
  );

  let issueView;
  const issueNumber = () =>
    selectedNumbers[0] ??
    snapshot.issues.find(issue => !issue.labels.some(label => /^P\d$/.test(label.name)))?.number;
  await check(
    'c. issue form pre-filled by Gemini, Apply swaps in a confirm panel, dry run',
    async () => {
      issueView = await render('issue', {number: issueNumber()});
      const {frame, id} = issueView;
      await frame.getByRole('tab', {name: `Triage #${issueNumber()}`}).waitFor();
      await recordNaturalHeight(id, 'issue');
      const markdown = await frame
        .locator('a2ui-basic-text')
        .evaluateAll(texts =>
          texts.some(text => text.querySelector('h1, h2, h3, h4, p code, pre, ul, ol, strong')),
        );
      const firstShot = await screenshot(id, 'c-issue');
      let suggested = false;
      let aiFailure = null;
      if (envFileHasKey()) {
        await button(frame, 'Suggest with AI').click();
        // Gemini can be overloaded; the action then reports a failure in place.
        await frame
          .getByText(/^AI suggestion, review before applying|^The AI suggestion failed/)
          .first()
          .waitFor({timeout: 90_000});
        aiFailure = await frame
          .getByText(/^The AI suggestion failed.*/)
          .first()
          .textContent()
          .catch(() => null);
        suggested = !aiFailure;
      }
      const suggestShot = await screenshot(id, 'c-issue-suggested');
      await frame.getByRole('tab', {name: 'Labels and owner'}).click();
      await recordNaturalHeight(id, 'issue (Labels and owner tab)');
      const formShot = await screenshot(id, 'c-issue-form');
      const apply = button(frame, 'Apply…');
      // "No priority" clears the choice, and Apply's check then disables it.
      await frame.getByRole('button', {name: 'None', exact: true}).click();
      if (!(await apply.isDisabled())) throw new Error('Apply is enabled without a priority');
      if (await apply.isDisabled()) {
        // The suggestion may need an owner (P0/P1); pick P2 so the rules pass.
        await frame.getByRole('button', {name: 'P2', exact: true}).click();
      }
      if (await apply.isDisabled()) throw new Error('Apply stays disabled');
      const frames = await frameCount();
      await apply.click();
      await button(frame, 'Confirm (dry run)').waitFor({timeout: 10_000});
      const confirmShot = await screenshot(id, 'c-issue-confirm');
      await button(frame, 'Confirm (dry run)').click();
      await frame
        .getByText(/^Dry run: \d+ changes? to 1 item not written|^Nothing to change/)
        .waitFor({timeout: 10_000});
      await button(frame, 'Apply…').waitFor();
      if ((await frameCount()) !== frames) throw new Error('Apply opened a new frame');
      const doneShot = await screenshot(id, 'c-issue-dry-run');
      return {
        screenshot: [firstShot, suggestShot, formShot, confirmShot, doneShot],
        markdownRendered: markdown,
        suggested,
        ...(suggested
          ? {}
          : {
              note: aiFailure
                ? `Gemini unavailable: ${aiFailure.slice(0, 120)}`
                : 'no GEMINI_API_KEY: AI step skipped',
            }),
      };
    },
  );

  await check('d. template reply picker previews and fills the reply', async () => {
    const {frame, id} = issueView;
    await frame.getByRole('tab', {name: 'Reply'}).click();
    await recordNaturalHeight(id, 'issue (Reply tab)');
    await frame.getByRole('button', {name: 'Requesting information', exact: true}).click();
    await button(frame, 'Preview and use').click();
    await frame
      .getByText('Browser console logs or exact protocol payload')
      .first()
      .waitFor({timeout: 10_000});
    const reply = await frame
      .locator('a2ui-basic-textfield', {hasText: 'Reply (posted as a comment'})
      .locator('textarea')
      .inputValue();
    if (!reply.startsWith('To help us diagnose this'))
      throw new Error(`Reply is ${JSON.stringify(reply.slice(0, 40))}`);
    // The preview renders the reply's markdown: a numbered list and emphasis, no raw markers.
    const preview = frame
      .locator('a2ui-basic-text', {hasText: 'Browser console logs or exact protocol payload'})
      .first();
    const rendered = await preview.evaluate(element => ({
      list: element.querySelectorAll('ol li').length,
      emphasis: element.querySelectorAll('em').length,
      text: element.textContent ?? '',
    }));
    if (rendered.list !== 2 || rendered.emphasis === 0 || /(^|\s)_|`/.test(rendered.text)) {
      throw new Error(`Reply preview is not rendered markdown: ${JSON.stringify(rendered)}`);
    }
    return {screenshot: await screenshot(id, 'd-template-reply')};
  });

  await check('e. follow-up buttons post template messages with ui/message', async () => {
    const {frame, id} = issueView;
    const number = issueNumber();
    await button(frame, 'Find duplicates').click();
    const similar = await waitForLog(
      'messages',
      entry => entry.frame === id && JSON.stringify(entry.params).includes('similar to issue'),
    );
    await button(frame, 'Draft a reply with the assistant').click();
    const draft = await waitForLog(
      'messages',
      entry => entry.frame === id && JSON.stringify(entry.params).includes('Draft a reply'),
    );
    const texts = [similar, draft].map(entry => entry.params.content[0].text);
    if (
      !texts[0].includes(`issue "${number}"`) ||
      !texts[1].includes('"Requesting information" template')
    ) {
      throw new Error(`Unexpected follow-ups: ${JSON.stringify(texts)}`);
    }
    return {messages: texts};
  });

  await check(
    'f. PR review form keeps Submit disabled until valid, then confirms a dry run',
    async () => {
      const pull = snapshot.pulls[0];
      const view = await render('pull_request', {number: pull.number});
      const {frame, id} = view;
      await frame.locator('a2ui-triage-check-status').first().waitFor();
      await frame.locator('a2ui-triage-diff-stat').first().waitFor();
      await recordNaturalHeight(id, 'pull_request');
      const submit = button(frame, 'Submit review…');
      const initially = await submit.isDisabled();
      await frame.getByRole('button', {name: 'Request changes', exact: true}).click();
      const withoutBody = await submit.isDisabled();
      const invalidShot = await screenshot(id, 'f-review-invalid');
      await frame
        .locator('a2ui-basic-textfield', {hasText: 'Review comment'})
        .locator('textarea')
        .fill('Please add a test for the empty case.');
      const withBody = await submit.isDisabled();
      if (!initially || !withoutBody || withBody) {
        throw new Error(
          `Submit disabled: initially=${initially} withoutBody=${withoutBody} withBody=${withBody}`,
        );
      }
      await frame.getByRole('tab', {name: /^Files/}).click();
      const filesShot = await screenshot(id, 'f-review-files');
      await submit.click();
      await button(frame, 'Confirm (dry run)').click();
      await frame.getByText(/^Dry run: 1 change to 1 item not written/).waitFor({timeout: 10_000});
      return {screenshot: [invalidShot, filesShot, await screenshot(id, 'f-review-dry-run')]};
    },
  );

  await check(
    'g. dashboard Vega chart, Slider and DateTimeInput filters refresh in place',
    async () => {
      const view = await render('triage_dashboard', {});
      const {frame, id} = view;
      await frame.locator('a2ui-vega-chart svg').first().waitFor({timeout: 15_000});
      const marks = await frame.locator('a2ui-vega-chart svg path').count();
      await recordNaturalHeight(id, 'triage_dashboard');
      const chartShot = await screenshot(id, 'g-dashboard');
      const frames = await frameCount();
      await frame.locator('a2ui-slider input[type=range]').evaluate(input => {
        input.value = '7';
        input.dispatchEvent(new Event('input', {bubbles: true}));
      });
      await frame.getByText('PRs are stale after 7 days').waitFor();
      await frame.locator('a2ui-datetimeinput input[type=date]').fill('2026-10-01');
      await button(frame, 'Update').click();
      await frame
        .getByText(/opened since 2026-10-01, by week and priority/)
        .waitFor({timeout: 10_000});
      if ((await frameCount()) !== frames) throw new Error('Update opened a new frame');
      const filteredShot = await screenshot(id, 'g-dashboard-filtered');
      await frame.getByRole('tab', {name: /^Stale PRs/}).click();
      const staleShot = await screenshot(id, 'g-dashboard-stale');
      await frame.getByRole('tab', {name: 'By component'}).click();
      await button(frame, 'Show in inbox').first().click();
      const drill = await waitForLog('messages', entry => entry.frame === id);
      return {
        screenshot: [chartShot, filteredShot, staleShot],
        svgPaths: marks,
        drillDown: drill.params.content[0].text,
      };
    },
  );

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
console.log(`Largest model context: ${report.maxModelContextBytes} bytes`);
console.log(
  `Console errors: ${report.consoleErrors.length}, markdown warnings: ${report.markdownWarnings}`,
);
console.log(`Report: ${join(outDir, 'report.json')}`);
process.exitCode = report.checks.some(entry => entry.status === 'fail') ? 1 : 0;
