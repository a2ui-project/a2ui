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
 * Helpers of the demo tests. They read the page through `window.demo` (see client/src/main.tsx)
 * and never depend on the paths or ids a model chose, so the same tests run against recorded and
 * live responses.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  test as base,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {USE_CASES, type UseCase} from '@a2ui-labs/react-app-demo-client/use_cases';

export const MODE: 'live' | 'recorded' =
  process.env['DEMO_E2E_MODE'] === 'live' ? 'live' : 'recorded';
export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');
export const SCREENSHOT_DIR = process.env['SCREENSHOT_DIR'] ?? join(RESULTS_DIR, 'screens');
const TURN_TIMEOUT = MODE === 'live' ? 150_000 : 60_000;

/** A row of the client's bridge log (client/src/services/bridge_log.ts). */
export interface BridgeEntry {
  seq: number;
  time: number;
  direction: 'app→host' | 'host→app' | 'lifecycle';
  method: string;
  id?: number | string;
  request?: {method: string; durationMs: number};
  payload: unknown;
}

interface TurnSnapshot {
  id: string;
  status: string;
  surfaceIds: string[];
  marks: Record<string, number>;
  error: string | null;
  debug: {retries: number; usage: Record<string, number>; model: string} | null;
}

declare global {
  interface Window {
    demo: {
      turns(): TurnSnapshot[];
      bridge(turnId: string): BridgeEntry[];
      dataModel(surfaceId: string): unknown;
    };
  }
}

/**
 * The tests' `test`: it fails a test when any frame (the page, the sandbox proxy or an app frame)
 * logs a console error or throws an uncaught exception, such as a cross-origin SecurityError.
 */
export const test = base.extend<{allowedFrameErrors: RegExp[]; frameErrors: string[]}>({
  /** Errors a test provokes on purpose, which `frameErrors` then ignores. */
  allowedFrameErrors: [[], {option: true}],
  frameErrors: [
    async ({page, allowedFrameErrors}, use) => {
      const errors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') {
          errors.push(`console.error [${message.location().url}] ${message.text()}`);
        }
      });
      page.on('pageerror', error => errors.push(`uncaught ${error.name}: ${error.message}`));
      await use(errors);
      const unexpected = errors.filter(error => !allowedFrameErrors.some(re => re.test(error)));
      expect(
        unexpected.filter(error => /SecurityError|Blocked a frame/.test(error)),
        'cross-origin access errors',
      ).toEqual([]);
      expect(unexpected, 'console errors and uncaught exceptions in any frame').toEqual([]);
    },
    {auto: true},
  ],
});

/** The follow-up of the loan use case: it rewrites the app, so it exercises surface replacement. */
export const LOAN_FOLLOW_UP =
  'Make it a line chart instead, and add a toggle between 10 and 15 years.';

export function useCase(id: UseCase['id']): UseCase {
  return USE_CASES.find(candidate => candidate.id === id)!;
}

/** Opens the demo, checks the first-load state, and runs a use case's prompt to completion. */
export async function runUseCase(
  page: Page,
  id: UseCase['id'],
): Promise<{turn: Locator; turnId: string}> {
  await page.goto('/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  // Everything that explains the system starts collapsed.
  await expect(page.getByTestId('about-panel')).toHaveCount(0);
  await expect(page.getByTestId('show-internals').locator('input')).not.toBeChecked();
  await page.getByTestId(`chip-${id}`).click();
  const turn = page.getByTestId('turn').last();
  await expect(turn).toHaveAttribute('data-status', /done|error/, {timeout: TURN_TIMEOUT});
  const turnId = (await turn.getAttribute('data-turn-id'))!;
  const snapshot = await turnSnapshot(page, turnId);
  expect(snapshot.error, `turn error: ${snapshot.error}`).toBeNull();
  await expect(turn.getByTestId('internals-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(turn.locator('[role=tabpanel]')).toHaveCount(0);
  return {turn, turnId};
}

export async function turnSnapshot(page: Page, turnId: string): Promise<TurnSnapshot> {
  return page.evaluate(
    id => JSON.parse(JSON.stringify(window.demo.turns().find(turn => turn.id === id))),
    turnId,
  );
}

/**
 * Data marks of the Vega charts in an app frame: bars, points, lines. Legends, axes and brush
 * rectangles don't count, so an empty chart has none.
 */
export function chartMarks(frame: FrameLocator): Locator {
  return frame.locator('svg g.role-mark:not([class*="brush"]) > [role="graphics-symbol"]');
}

/** The app frame of the turn's first ReactApp (the inner frame of the sandbox proxy). */
export function appFrame(turn: Locator): FrameLocator {
  return turn.frameLocator('a2ui-react-app iframe').first().frameLocator('iframe');
}

/** Waits until the app reported `ui/rendered`. */
export async function waitForAppRendered(page: Page, turnId: string): Promise<void> {
  await expect
    .poll(async () => (await turnSnapshot(page, turnId)).marks['T7'], {timeout: 30_000})
    .toBeDefined();
}

export async function bridgeEntries(page: Page, turnId: string): Promise<BridgeEntry[]> {
  return page.evaluate(id => JSON.parse(JSON.stringify(window.demo.bridge(id))), turnId);
}

/** Bridge rows after `seq` that match `method` (a request's method also matches its response). */
export function entriesAfter(entries: BridgeEntry[], seq: number, method: string): BridgeEntry[] {
  return entries.filter(
    entry => entry.seq > seq && (entry.method === method || entry.request?.method === method),
  );
}

export async function lastSeq(page: Page, turnId: string): Promise<number> {
  return (await bridgeEntries(page, turnId)).at(-1)?.seq ?? 0;
}

/** The visible text of the turn's native components, through shadow roots, without frames. */
export async function nativeText(turn: Locator): Promise<string> {
  return turn
    .locator('[data-testid=surface]')
    .first()
    .evaluate(root => {
      const parts: string[] = [];
      const walk = (node: Node) => {
        if (node instanceof HTMLIFrameElement) {
          return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent ?? '');
        }
        if (node instanceof Element && node.shadowRoot) {
          walk(node.shadowRoot);
        }
        node.childNodes.forEach(walk);
      };
      walk(root);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    });
}

/** The data models of the turn's surfaces, as JSON. */
export async function dataModels(page: Page, turnId: string): Promise<string> {
  return page.evaluate(id => {
    const turn = window.demo.turns().find(candidate => candidate.id === id);
    return JSON.stringify(turn?.surfaceIds.map(surfaceId => window.demo.dataModel(surfaceId)));
  }, turnId);
}

/** Moves a native slider to a new value (30% of its range, or 65%), as a user's drag does. */
export async function moveNativeSlider(turn: Locator): Promise<void> {
  const slider = turn.locator('a2ui-slider input[type="range"]').first();
  await slider.scrollIntoViewIfNeeded();
  await slider.evaluate((element: HTMLInputElement) => {
    const min = Number(element.min || 0);
    const max = Number(element.max || 100);
    const step = Number(element.step) || 1;
    const at = (fraction: number) => Math.round((min + (max - min) * fraction) / step) * step;
    const target = at(0.3) === Number(element.value) ? at(0.65) : at(0.3);
    element.value = String(target);
    element.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    element.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
  });
}

/** Polls `check` until it holds or `timeoutMs` passes. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return check();
}

/**
 * Drags `source` onto `target`, trying the ways apps implement drag and drop: a real mouse drag
 * (HTML5 drag and drop in Chromium, or pointer events), then synthetic HTML5 drag events.
 * Returns the way that made `moved` true, or null.
 */
export async function dragAndDrop(
  page: Page,
  source: Locator,
  target: Locator,
  moved: () => Promise<boolean>,
): Promise<string | null> {
  await source.dragTo(target, {targetPosition: {x: 10, y: 20}});
  if (await waitUntil(moved, 2500)) {
    return 'mouse';
  }
  const transfer = await source.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', {dataTransfer: transfer});
  await target.dispatchEvent('dragenter', {dataTransfer: transfer});
  await target.dispatchEvent('dragover', {dataTransfer: transfer});
  await target.dispatchEvent('drop', {dataTransfer: transfer});
  await source.dispatchEvent('dragend', {dataTransfer: transfer});
  if (await waitUntil(moved, 2500)) {
    return 'html5-events';
  }
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, {steps: 15});
  await page.mouse.up();
  return (await waitUntil(moved, 2500)) ? 'pointer-steps' : null;
}

/** Drags a brush across the middle of a chart. */
export async function brushChart(page: Page, chart: Locator): Promise<void> {
  const box = (await chart.boundingBox())!;
  const y = box.y + box.height * 0.45;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y + box.height * 0.1, {steps: 12});
  await page.mouse.up();
}

/** Opens the turn's panel and checks that every tab shows real data for the turn. */
export async function checkPanels(
  turn: Locator,
  expectations: {bridgeMethods: string[]},
): Promise<void> {
  await turn.getByTestId('internals-toggle').click();
  await expect(turn.getByTestId('internals-toggle')).toHaveAttribute('aria-expanded', 'true');

  await turn.getByTestId('tab-express').click();
  const express = turn.getByTestId('express-code');
  await expect(express).toContainText('<a2ui>');
  await expect(express).toContainText('ReactApp(');
  await turn.getByTestId('raw-fold').first().click();
  await expect(express).toContainText('export default');

  await turn.getByTestId('tab-json').click();
  expect(await turn.getByTestId('json-message').count()).toBeGreaterThanOrEqual(2);
  await turn.getByTestId('json-message').first().locator('summary').click();
  await expect(turn.getByTestId('json-message').first()).toContainText('"version": "1.0"');

  await turn.getByTestId('tab-source').click();
  await expect(turn.getByTestId('react-source').first()).toContainText('from "a2ui"');

  await turn.getByTestId('tab-bridge').click();
  for (const method of ['reactApp/initialize', ...expectations.bridgeMethods]) {
    await expect(
      turn.locator(`[data-testid=bridge-row][data-method="${method}"]`).first(),
    ).toBeVisible();
  }

  await turn.getByTestId('tab-data').click();
  const tree = turn.getByTestId('data-model-tree').first();
  await expect(tree).toBeVisible();
  expect((await tree.innerText()).length).toBeGreaterThan(10);

  await turn.getByTestId('tab-performance').click();
  for (const checkpoint of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']) {
    await expect(
      turn.locator(`[data-checkpoint=${checkpoint}] .waterfall-ms`),
      `checkpoint ${checkpoint}`,
    ).toHaveText(/\d ms$/);
  }
}

/** The latency checkpoints of a turn in ms after T0, plus derived spans; written to results/. */
export async function recordLatency(
  page: Page,
  testInfo: TestInfo,
  id: UseCase['id'],
  turnId: string,
): Promise<Record<string, number>> {
  const turn = await turnSnapshot(page, turnId);
  const t0 = turn.marks['T0'] ?? 0;
  const checkpoints = Object.fromEntries(
    Object.entries(turn.marks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, at]) => [name, Math.round(at - t0)]),
  );
  const record = {
    useCase: id,
    mode: MODE,
    runId: process.env['DEMO_E2E_RUN_ID'],
    test: testInfo.title,
    model: turn.debug?.model,
    retries: turn.debug?.retries,
    usage: turn.debug?.usage,
    checkpoints,
    iframeReadyToRendered: (checkpoints['T7'] ?? NaN) - (checkpoints['T5'] ?? NaN),
    sourceCompleteToRendered: (checkpoints['T7'] ?? NaN) - (checkpoints['T4'] ?? NaN),
  };
  const dir = join(RESULTS_DIR, 'latency', MODE);
  mkdirSync(dir, {recursive: true});
  const stamp = String(process.env['DEMO_E2E_RUN_ID']).replace(/[:.]/g, '-');
  writeFileSync(join(dir, `${stamp}-${id}.json`), JSON.stringify(record, null, 2));
  return checkpoints;
}

/** Screenshots of the turn at desktop and narrow widths, always the same two window sizes. */
export async function screenshots(page: Page, turn: Locator, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, {recursive: true});
  const scrollToTurn = () =>
    turn.evaluate(element => {
      // Below the sticky masthead, so the prompt is readable.
      window.scrollTo({top: element.getBoundingClientRect().top + window.scrollY - 72});
    });
  await scrollToTurn();
  await page.screenshot({path: join(SCREENSHOT_DIR, `${name}-desktop.png`)});
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(400);
  await scrollToTurn();
  await page.screenshot({path: join(SCREENSHOT_DIR, `${name}-narrow.png`)});
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(300);
}
