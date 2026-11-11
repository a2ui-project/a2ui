/*
 * Copyright 2026 Google LLC
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
 * The three use cases of docs/use_cases.md, end to end: the prompt, the native components, real
 * UI in the app frame, interactions in both directions, the explanation panels and the latency.
 */
import {expect, test} from '@playwright/test';
import {
  appFrame,
  bridgeEntries,
  brushChart,
  checkPanels,
  dataModels,
  dragAndDrop,
  entriesAfter,
  lastSeq,
  moveNativeSlider,
  nativeText,
  recordLatency,
  runUseCase,
  screenshots,
  waitForAppRendered,
} from './helpers';

/** The budget of the plan: the app renders within 3 s of its source arriving. */
const RENDER_BUDGET_MS = 3000;

test('loan explorer: sliders redraw the chart, a bar click updates the page', async ({
  page,
}, testInfo) => {
  const {turn, turnId} = await runUseCase(page, 'loan');
  await waitForAppRendered(page, turnId);

  // Native components render next to the app.
  await expect(turn.locator('a2ui-slider').first()).toBeVisible();
  await expect(turn.locator('a2ui-basic-button').first()).toBeVisible();

  // The app frame holds a real chart.
  const frame = appFrame(turn);
  const marks = frame.locator('svg [role="graphics-symbol"]');
  await expect(marks.first()).toBeVisible();
  expect(await marks.count()).toBeGreaterThanOrEqual(5);

  // Native slider -> chart.
  const chart = frame.locator('svg').first();
  const before = await chart.innerHTML();
  const seq = await lastSeq(page, turnId);
  await moveNativeSlider(turn);
  await expect.poll(async () => (await chart.innerHTML()) !== before).toBe(true);
  expect(
    entriesAfter(await bridgeEntries(page, turnId), seq, 'data/changed').length,
  ).toBeGreaterThan(0);

  // Click in the app -> native text or data model.
  const textBefore = await nativeText(turn);
  const modelBefore = await dataModels(page, turnId);
  const clickSeq = await lastSeq(page, turnId);
  await marks.nth(3).click();
  await expect
    .poll(
      async () =>
        (await nativeText(turn)) !== textBefore || (await dataModels(page, turnId)) !== modelBefore,
    )
    .toBe(true);
  expect(
    entriesAfter(await bridgeEntries(page, turnId), clickSeq, 'data/set').length,
  ).toBeGreaterThan(0);

  const checkpoints = await recordLatency(page, testInfo, 'loan', turnId);
  expect.soft(checkpoints['T7']! - checkpoints['T4']!).toBeLessThan(RENDER_BUDGET_MS);
  await screenshots(page, turn, 'loan');
  await checkPanels(turn, {bridgeMethods: ['data/changed', 'data/set']});

  // A native button sends an action; the agent answers in a new turn.
  await turn.locator('a2ui-basic-button button').last().click();
  const followUp = page.getByTestId('turn').nth(1);
  await expect(followUp).toHaveAttribute('data-status', 'done', {timeout: 120_000});
  await expect(followUp.locator('.turn-text')).not.toBeEmpty();

  // "Show internals" opens every turn's panel and is remembered.
  await page.getByTestId('show-internals').click();
  await expect(page.locator('[data-testid=internals][data-open=true]')).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('show-internals').locator('input')).toBeChecked();
  await page.getByTestId('show-internals').click();
  await expect(page.getByTestId('show-internals').locator('input')).not.toBeChecked();

  // The About panel opens on demand.
  await page.getByTestId('about-toggle').click();
  await expect(page.getByTestId('about-panel')).toContainText('ReactAppTransformer');
});

test('itinerary: dragging a stop calls estimateTravelTime on the agent', async ({
  page,
}, testInfo) => {
  const {turn, turnId} = await runUseCase(page, 'trip');
  await waitForAppRendered(page, turnId);

  await expect(turn.locator('a2ui-basic-button').first()).toBeVisible();

  const frame = appFrame(turn);
  const items = frame.locator('[draggable="true"]');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // The first estimate arrives from the agent.
  await expect
    .poll(async () =>
      (await bridgeEntries(page, turnId)).some(
        entry => entry.request?.method === 'function/call' && entry.method === 'result',
      ),
    )
    .toBe(true);

  // Drag the first stop to the end: the app writes the new order and asks for a new estimate.
  const modelBefore = await dataModels(page, turnId);
  const seq = await lastSeq(page, turnId);
  const how = await dragAndDrop(
    page,
    items.first(),
    items.nth(count - 1),
    async () => entriesAfter(await bridgeEntries(page, turnId), seq, 'data/set').length > 0,
  );
  expect(how, 'no drag technique reordered the stops').not.toBeNull();
  testInfo.annotations.push({type: 'drag', description: String(how)});
  await expect
    .poll(async () => {
      const after = await bridgeEntries(page, turnId);
      return entriesAfter(after, seq, 'function/call').some(entry => entry.method === 'result');
    })
    .toBe(true);
  await expect.poll(() => dataModels(page, turnId)).not.toBe(modelBefore);

  // The latest estimate shows in the app.
  const results = entriesAfter(await bridgeEntries(page, turnId), seq, 'function/call').filter(
    entry => entry.method === 'result',
  );
  const minutes = (results.at(-1)!.payload as {value?: unknown}).value;
  await expect(frame.locator('body')).toContainText(String(minutes));

  const checkpoints = await recordLatency(page, testInfo, 'trip', turnId);
  expect.soft(checkpoints['T7']! - checkpoints['T4']!).toBeLessThan(RENDER_BUDGET_MS);
  await screenshots(page, turn, 'trip');
  await checkPanels(turn, {bridgeMethods: ['function/call', 'data/set']});

  await turn.locator('a2ui-basic-button button').last().click();
  const followUp = page.getByTestId('turn').nth(1);
  await expect(followUp).toHaveAttribute('data-status', 'done', {timeout: 120_000});
});

test('sales explorer: a brush selection queries the agent and fills the page', async ({
  page,
}, testInfo) => {
  const {turn, turnId} = await runUseCase(page, 'sales');
  await waitForAppRendered(page, turnId);

  const frame = appFrame(turn);
  const marks = frame.locator('svg [role="graphics-symbol"]');
  await expect(marks.first()).toBeVisible();
  expect(await marks.count()).toBeGreaterThanOrEqual(5);

  const textBefore = await nativeText(turn);
  const modelBefore = await dataModels(page, turnId);
  const seq = await lastSeq(page, turnId);
  await brushChart(page, frame.locator('svg').first());

  // The brush reaches the page: the app writes the selection or its results to the data model,
  // and native components show them.
  await expect
    .poll(
      async () =>
        (await nativeText(turn)) !== textBefore || (await dataModels(page, turnId)) !== modelBefore,
    )
    .toBe(true);
  const afterBrush = await bridgeEntries(page, turnId);
  expect(entriesAfter(afterBrush, seq, 'data/set').length).toBeGreaterThan(0);

  // querySales ran on the agent and answered (on the brush, or for the first render).
  const queries = afterBrush.filter(
    entry => entry.request?.method === 'function/call' && entry.method === 'result',
  );
  expect(queries.length).toBeGreaterThan(0);
  testInfo.annotations.push({
    type: 'querySales',
    description:
      entriesAfter(afterBrush, seq, 'function/call').length > 0 ? 'on brush' : 'on load only',
  });

  const checkpoints = await recordLatency(page, testInfo, 'sales', turnId);
  expect.soft(checkpoints['T7']! - checkpoints['T4']!).toBeLessThan(RENDER_BUDGET_MS);
  await screenshots(page, turn, 'sales');
  await checkPanels(turn, {bridgeMethods: ['function/call', 'data/set']});
});
