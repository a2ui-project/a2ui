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
 * End-to-end tests for the Kanban showcase across all three live services:
 * the Vite/Lit chat host (`:5173`), the A2A agent (`:10007`), and the
 * Streamable HTTP MCP server (`:8788`).
 */

import {expect, test, type Frame, type Page} from '@playwright/test';

const MCP_RESET_URL = 'http://localhost:8788/reset';
const TEST_AGENT_QUERY = '/?agent_url=http://localhost:10008';

/** Finds the inner `srcdoc` frame where the MCP App board UI renders. */
async function waitForBoardFrame(page: Page): Promise<Frame> {
  await expect
    .poll(
      () => {
        for (const frame of page.frames()) {
          if (frame.url() === 'about:srcdoc') {
            return frame;
          }
        }
        return null;
      },
      {message: 'waiting for the inner MCP App srcdoc frame'},
    )
    .not.toBeNull();
  const frame = page.frames().find(candidate => candidate.url() === 'about:srcdoc')!;
  await expect(frame.locator('.column')).toHaveCount(4);
  return frame;
}

/** Computes WCAG 2.1 contrast failures (< 4.5:1) for all visible text elements in a frame. */
async function findLowContrastElements(frame: Frame) {
  return frame.evaluate(() => {
    function parseRgb(str: string | null): [number, number, number, number] | null {
      const match = str?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) {
        return null;
      }
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] !== undefined ? Number(match[4]) : 1,
      ];
    }

    function luminance([r, g, b]: [number, number, number, number]): number {
      const channels = [r, g, b].map(value => {
        const srgb = value / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    function contrastRatio(
      fg: [number, number, number, number],
      bg: [number, number, number, number],
    ): number {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    }

    function effectiveBackground(el: Element): [number, number, number, number] {
      let current: Node | null = el;
      while (current) {
        if (current instanceof Element) {
          const rgb = parseRgb(getComputedStyle(current).backgroundColor);
          if (rgb && rgb[3] > 0) {
            return rgb;
          }
        }
        const root = current.getRootNode();
        current =
          (current as Element).parentElement ?? (root instanceof ShadowRoot ? root.host : null);
      }
      return parseRgb(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    }

    const ignoredTags = new Set([
      'HEAD',
      'TITLE',
      'STYLE',
      'SCRIPT',
      'META',
      'LINK',
      'HTML',
      'BODY',
    ]);
    const failures: Array<{
      tag: string;
      text: string;
      color: string;
      background: string;
      ratio: number;
    }> = [];

    function walk(root: Document | ShadowRoot): void {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
          walk(el.shadowRoot);
        }
        if (ignoredTags.has(el.tagName)) {
          continue;
        }
        if (el instanceof HTMLButtonElement && el.disabled) {
          continue;
        }
        const directText = Array.from(el.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim() ?? '')
          .join(' ')
          .trim();
        if (!directText) {
          continue;
        }
        const style = getComputedStyle(el);
        const fg = parseRgb(style.color);
        const bg = effectiveBackground(el);
        if (fg && bg) {
          const ratio = contrastRatio(fg, bg);
          if (ratio < 4.5) {
            failures.push({
              tag: el.tagName.toLowerCase(),
              text: directText.slice(0, 40),
              color: style.color,
              background: `rgb(${bg.slice(0, 3).join(', ')})`,
              ratio,
            });
          }
        }
      }
    }

    walk(document);
    return failures;
  });
}

test.describe('Kanban showcase E2E CUJs', () => {
  test.beforeEach(async ({request, page}) => {
    const response = await request.post(MCP_RESET_URL);
    expect(response.ok()).toBe(true);
    await page.goto(TEST_AGENT_QUERY);
  });

  test('CUJ 1 & 2: opens the sprint board and applies an agent dataModelUpdate (Channel A)', async ({
    page,
  }) => {
    await expect(page.locator('.chat-column')).toBeVisible();
    await expect(page.locator('.app-column')).toBeVisible();
    const chatBox = await page.locator('.chat-column').boundingBox();
    const appBox = await page.locator('.app-column').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(appBox).not.toBeNull();
    expect(chatBox!.x).toBeLessThan(appBox!.x);

    await page.getByRole('button', {name: 'Show me the sprint board'}).click();

    await expect(page.locator('.entry.agent').first()).toContainText('Here is the sprint board');
    await expect(page.locator('.surface')).toContainText('Todo: 2');
    await expect(page.locator('.surface')).toContainText('Review 3/3');
    await expect(page.locator('.surface')).toContainText('Done: 1');
    await expect(page.locator('.surface')).toContainText('No card selected');

    const boardFrame = await waitForBoardFrame(page);
    await expect(boardFrame.locator('li.card')).toHaveCount(8);
    await expect(boardFrame.locator('.column[data-column-id="todo"] li.card')).toHaveCount(2);
    await expect(boardFrame.locator('.column[data-column-id="review"] li.card')).toHaveCount(3);

    // Channel A: agent mutates the board via MCP and pushes updateDataModel to the live McpApp.
    await page.getByRole('button', {name: 'Move Write docs back to Todo'}).click();

    await expect(page.locator('.entry.agent').last()).toContainText('Moved Write docs to Todo.');
    await expect(page.locator('.surface')).toContainText('Todo: 3');
    await expect(page.locator('.surface')).toContainText('Review 2/3');
    await expect(boardFrame.locator('.column[data-column-id="todo"] li.card')).toHaveCount(3);
    await expect(boardFrame.locator('.column[data-column-id="review"] li.card')).toHaveCount(2);
  });

  test('CUJ 3: publishes card selection and filter state to the host and agent (Channel B)', async ({
    page,
  }) => {
    await page.getByRole('button', {name: 'Show me the sprint board'}).click();
    const boardFrame = await waitForBoardFrame(page);

    const migrateCard = boardFrame.locator('li.card[data-task-id="t3"]');
    await migrateCard.click();
    await expect(migrateCard).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.surface')).toContainText(
      'Selected: Migrate DB in Todo (Ana, due 2026-10-17)',
    );

    await page
      .getByRole('button', {name: 'Who owns the selected card and when is it due?'})
      .click();
    await expect(page.locator('.entry.agent').last()).toContainText(
      'Migrate DB is owned by Ana and due 2026-10-17 (in Todo).',
    );

    // Assignee filter inside the MCP App iframe narrows visible cards.
    const filter = boardFrame.locator('select.filter');
    await filter.selectOption('Ana');
    await expect(boardFrame.locator('li.card')).toHaveCount(3);
    await filter.selectOption('');
    await expect(boardFrame.locator('li.card')).toHaveCount(8);
  });

  test('CUJ 4: moving a card into Review updates sibling counters and triggers a WIP warning (Channels C & D)', async ({
    page,
  }) => {
    await page.getByRole('button', {name: 'Show me the sprint board'}).click();
    const boardFrame = await waitForBoardFrame(page);

    const fixLoginCard = boardFrame.locator('li.card[data-task-id="t1"]');
    await fixLoginCard.focus();
    await fixLoginCard.press('ArrowRight');

    // Channel C: sibling summary counter updates immediately from the app's data-model-change.
    await expect(page.locator('.surface')).toContainText('Review 4/3 (over limit)');
    await expect(boardFrame.locator('.column[data-column-id="review"]')).toHaveClass(/over-limit/);

    // Channel D: ui/message becomes a user turn and the agent replies with a WIP warning.
    await expect(page.locator('.entry.user').last()).toContainText(
      'Moved "Fix login" from In progress to Review.',
    );
    await expect(page.locator('.entry.agent').last()).toContainText(
      'Review now has 4 cards, over its WIP limit of 3. Want me to move one back?',
    );
  });

  test('CUJ 5: splitting a card from the board proposes and creates subtasks on confirmation (Channels D & A)', async ({
    page,
  }) => {
    await page.getByRole('button', {name: 'Show me the sprint board'}).click();
    const boardFrame = await waitForBoardFrame(page);

    await boardFrame.locator('li.card[data-task-id="t3"] button.split').click();

    await expect(page.locator('.entry.user').last()).toContainText(
      'Please split "Migrate DB" into smaller subtasks.',
    );
    await expect(page.locator('.entry.agent').last()).toContainText(
      'I would split "Migrate DB" into "Plan Migrate DB", "Implement Migrate DB", "Verify Migrate DB". Shall I create them?',
    );

    const input = page.getByLabel('Message to the agent');
    await input.fill('Yes');
    await page.getByRole('button', {name: 'Send'}).click();

    await expect(page.locator('.entry.agent').last()).toContainText(
      'Created 3 subtasks next to Migrate DB.',
    );
    await expect(page.locator('.surface')).toContainText('Todo: 5');
    await expect(boardFrame.locator('.column[data-column-id="todo"] li.card')).toHaveCount(5);
    await expect(boardFrame.locator('.column[data-column-id="todo"]')).toContainText(
      'Plan Migrate DB',
    );
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`CUJ 6: meets WCAG AA text contrast (>= 4.5:1) in ${colorScheme} mode`, async ({page}) => {
      await page.emulateMedia({colorScheme});
      await page.goto(TEST_AGENT_QUERY);
      await page.getByRole('button', {name: 'Show me the sprint board'}).click();
      const boardFrame = await waitForBoardFrame(page);

      const hostFailures = await findLowContrastElements(page.mainFrame());
      expect(hostFailures, `Host contrast failures in ${colorScheme} mode`).toEqual([]);

      const boardFailures = await findLowContrastElements(boardFrame);
      expect(boardFailures, `Board iframe contrast failures in ${colorScheme} mode`).toEqual([]);
    });
  }
});
