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

import {expect, test, type FrameLocator, type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const RUNTIME_ORIGIN = `http://127.0.0.1:${Number(process.env['REACT_APP_FIXTURE_PORT'] ?? 47317) + 1}`;
const SCREENSHOT_DIR = process.env['SCREENSHOT_DIR'] ?? join('test-results', 'screens');

/** The app's document: the inner frame inside the sandbox proxy frame of the ReactApp element. */
function appFrame(page: Page): FrameLocator {
  return page.frameLocator('a2ui-react-app iframe').frameLocator('iframe');
}

async function openFixture(page: Page) {
  const runtimeRequests: Array<{url: string; cors: string | null}> = [];
  page.on('response', response => {
    if (response.url().startsWith(RUNTIME_ORIGIN)) {
      runtimeRequests.push({
        url: response.url(),
        cors: response.headers()['access-control-allow-origin'] ?? null,
      });
    }
  });
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}`);
  await expect(appFrame(page).getByTestId('count')).toHaveText('3');
  return {runtimeRequests, consoleErrors};
}

test.describe('ReactApp in the real double iframe', () => {
  test('renders real DOM in the inner frame, loading the runtime cross-origin with CORS', async ({
    page,
  }) => {
    const {runtimeRequests, consoleErrors} = await openFixture(page);
    const frame = appFrame(page);

    await expect(frame.getByRole('heading', {name: 'Fixture app'})).toBeVisible();
    await expect(frame.getByRole('button', {name: 'Increment'})).toBeVisible();
    // The theme reached the frame: the primary button uses the host's --a2ui-color-primary.
    await expect(frame.getByRole('button', {name: 'Increment'})).toHaveCSS(
      'background-color',
      'rgb(200, 85, 61)',
    );
    expect(runtimeRequests.length).toBeGreaterThan(3);
    expect(runtimeRequests.every(request => request.cors === '*')).toBe(true);
    // The inner frame is sandboxed without allow-same-origin.
    const sandbox = await page
      .frameLocator('a2ui-react-app iframe')
      .locator('iframe')
      .getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
    expect(consoleErrors).toEqual([]);

    mkdirSync(SCREENSHOT_DIR, {recursive: true});
    await page.screenshot({path: join(SCREENSHOT_DIR, 'react_app_fixture.png'), fullPage: true});
  });

  test('native data model changes reach the app', async ({page}) => {
    await openFixture(page);
    const frame = appFrame(page);

    // A native component writes the path.
    await page.getByRole('slider', {name: 'Native slider'}).fill('17');
    await expect(frame.getByTestId('count')).toHaveText('17');

    // The agent writes the path.
    await page.evaluate(() => window.fixture.setDataFromAgent('/fixture/count', 41));
    await expect(frame.getByTestId('count')).toHaveText('41');
  });

  test('loads the theme font faces in the frame before the first render', async ({page}) => {
    await openFixture(page);
    const frame = appFrame(page);

    // The count rendered, so the runtime has waited for the fonts.
    const fonts = await frame.locator('body').evaluate(() => {
      const loaded: string[] = [];
      document.fonts.forEach(face => {
        if (face.status === 'loaded') {
          loaded.push(face.family.replace(/"/g, ''));
        }
      });
      return {
        size: document.fonts.size,
        loaded,
        check: document.fonts.check('16px "IBM Plex Sans"'),
      };
    });
    expect(fonts).toEqual({size: 1, loaded: ['IBM Plex Sans'], check: true});
    await expect(frame.getByRole('heading', {name: 'Fixture app'})).toHaveCSS(
      'font-family',
      /^"IBM Plex Sans"/,
    );
  });

  test('app writes reach the data model and native components', async ({page}) => {
    await openFixture(page);
    const frame = appFrame(page);

    await frame.getByRole('button', {name: 'Increment'}).click();
    await frame.getByRole('button', {name: 'Increment'}).click();

    await expect(frame.getByTestId('count')).toHaveText('5');
    await expect.poll(() => page.evaluate(() => window.fixture.getData('/fixture/count'))).toBe(5);
    await expect(page.getByText('Native count: 5')).toBeVisible();
  });

  test('callFunction round-trips a local function and a mocked agent function', async ({page}) => {
    await openFixture(page);
    const frame = appFrame(page);

    // Agent function, declared in a third catalog on a surface without a default catalog.
    await expect(frame.getByTestId('minutes')).toHaveText('75');
    const agentCalls = await page.evaluate(() => window.fixture.agentCalls);
    expect(agentCalls).toEqual([
      expect.objectContaining({
        callFunction: {
          '@call': 'estimateTravelTime',
          catalogId: 'https://example.com/fixture/demo/v1/catalog.json',
          args: {stops: ['louvre', 'eiffel', 'orsay']},
        },
      }),
    ]);

    // Local function of the basic catalog.
    await frame.getByRole('button', {name: 'Format'}).click();
    await expect(frame.getByTestId('formatted')).toHaveText('$3,000.00');

    // Actions reach the surface's action handler, with the ReactApp as the source.
    await frame.getByRole('button', {name: 'Done'}).click();
    await expect.poll(() => page.evaluate(() => window.fixture.actions.length)).toBe(1);
    const [action] = await page.evaluate(() => window.fixture.actions);
    expect(action).toEqual(
      expect.objectContaining({name: 'fixtureDone', sourceComponentId: 'app', context: {count: 3}}),
    );
  });

  test('reports the time from iframe ready to ui/rendered', async ({page}) => {
    await openFixture(page);
    await expect.poll(() => page.evaluate(() => window.fixture.rendered.length)).toBe(1);

    const [rendered] = await page.evaluate(() => window.fixture.rendered);
    expect(rendered.frameReadyToRenderedMs).toBeGreaterThan(0);
    expect(rendered.timings['rendered']).toBeGreaterThan(0);
    console.log(
      `iframe ready -> ui/rendered: ${rendered.frameReadyToRenderedMs} ms; ` +
        `frame timings: ${JSON.stringify(rendered.timings)}`,
    );

    // A second load uses the browser cache for the immutable runtime files.
    await page.reload();
    await expect(appFrame(page).getByTestId('count')).toHaveText('3');
    await expect.poll(() => page.evaluate(() => window.fixture.rendered.length)).toBe(1);
    const [warm] = await page.evaluate(() => window.fixture.rendered);
    console.log(`warm reload: iframe ready -> ui/rendered: ${warm.frameReadyToRenderedMs} ms`);
  });
});

test.describe('catalog examples in the real double iframe', () => {
  test('loan explorer: VegaChart renders, native sliders redraw it, a bar click updates native text', async ({
    page,
  }) => {
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=loan_explorer`);
    const frame = appFrame(page);
    const bars = frame.locator('svg [role="graphics-symbol"][aria-roledescription="bar"]');

    // vega-embed loads lazily on the first chart; formatCurrency labels arrive over the bridge.
    await expect(bars).toHaveCount(10, {timeout: 15_000});
    const firstBar = bars.first();
    const before = await firstBar.getAttribute('aria-label');

    await page.getByRole('slider', {name: 'Interest rate (%)'}).fill('11');
    await expect.poll(() => firstBar.getAttribute('aria-label')).not.toBe(before);

    await bars.nth(3).click();
    await expect(page.getByText(/^After year 4: \$[\d,]+\.\d{2} left to pay$/)).toBeVisible();
    expect(await page.evaluate(() => window.fixture.getData('/loan/selectedYear'))).toBe(4);
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);

    mkdirSync(SCREENSHOT_DIR, {recursive: true});
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'react_app_loan_explorer.png'),
      fullPage: true,
    });
  });

  test('lap timer: the app appends to a list a native List renders', async ({page}) => {
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=lap_timer`);
    const frame = appFrame(page);

    await frame.getByRole('button', {name: 'Start'}).click();
    await page.waitForTimeout(250);
    await frame.getByRole('button', {name: 'Lap'}).click();
    await frame.getByRole('button', {name: 'Lap'}).click();

    await expect
      .poll(() => page.evaluate(() => (window.fixture.getData('/timer/laps') as unknown[]).length))
      .toBe(2);
    await expect(page.getByText(/^0:00\.\d$/)).toHaveCount(2);
  });
});

test.describe('typed bindings and server compile', () => {
  test('a2ui:bindings calls round-trip through the module the frame makes', async ({page}) => {
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=bindings`);
    const frame = appFrame(page);

    // Two stops at 25 minutes each from the mocked agent, and the basic catalog's formatCurrency.
    await expect(frame.getByTestId('binding-minutes')).toHaveText('50');
    await expect(frame.getByTestId('binding-price')).toHaveText('$42.00');
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
  });

  test('an app sent with compiled code skips the frame transpile', async ({page}) => {
    const transpileChunks: string[] = [];
    page.on('request', request => {
      if (/\/chunks\/transpile-/.test(request.url())) {
        transpileChunks.push(request.url());
      }
    });
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=bindings_compiled`);
    const frame = appFrame(page);

    await expect(frame.getByTestId('binding-minutes')).toHaveText('50');
    await expect(frame.getByTestId('binding-price')).toHaveText('$42.00');
    await expect.poll(() => page.evaluate(() => window.fixture.rendered.length)).toBe(1);
    const [rendered] = await page.evaluate(() => window.fixture.rendered);
    expect(rendered.timings['transpileMs']).toBe(0);
    expect(transpileChunks).toEqual([]);
    console.log(`compiled app: iframe ready -> ui/rendered: ${rendered.frameReadyToRenderedMs} ms`);
  });

  test('inlineDataUrls loads the runtime, Sucrase and VegaChart from data: URLs with zero inner-frame HTTP requests', async ({
    page,
  }) => {
    const innerFrameHttpRequests: string[] = [];
    page.on('request', request => {
      const frame = request.frame();
      if (
        frame &&
        frame !== page.mainFrame() &&
        frame.parentFrame() &&
        frame.parentFrame() !== page.mainFrame() &&
        /^https?:/.test(request.url())
      ) {
        innerFrameHttpRequests.push(request.url());
      }
    });
    await page.goto(
      `/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&inline=1&example=loan_explorer`,
    );
    const frame = appFrame(page);

    const bars = frame.locator('[aria-roledescription="bar"]');
    await expect(bars).toHaveCount(10);
    const importMap = await frame
      .locator('script[type="importmap"]')
      .evaluate(el => JSON.parse(el.textContent ?? '{}') as {imports: Record<string, string>});
    expect(
      Object.values(importMap.imports).every(url => url.startsWith('data:text/javascript;base64,')),
    ).toBe(true);
    expect(await frame.locator('link[rel="modulepreload"]').count()).toBe(0);
    expect(innerFrameHttpRequests).toEqual([]);
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
  });
});
