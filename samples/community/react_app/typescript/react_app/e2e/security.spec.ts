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
 * Fixture tests of the host's security checks and error reporting. They live in their own file
 * because they turn tracing off: trace snapshots evaluate scripts in every frame as user
 * gestures, which would activate the page while the gesture test expects no activation.
 */

import {expect, test, type FrameLocator, type Page} from '@playwright/test';

const RUNTIME_ORIGIN = `http://127.0.0.1:${Number(process.env['REACT_APP_FIXTURE_PORT'] ?? 47317) + 1}`;

test.use({trace: 'off'});

/** The app's document: the inner frame inside the sandbox proxy frame of the ReactApp element. */
function appFrame(page: Page): FrameLocator {
  return page.frameLocator('a2ui-react-app iframe').frameLocator('iframe');
}

test.describe('security and error reporting', () => {
  test('refuses an action dispatched from an effect, and accepts one from a click', async ({
    page,
  }) => {
    // Playwright runs evaluations and locator polls as user gestures too, so the test touches
    // the page only after the refusal, waiting for its log line.
    const refused = page.waitForEvent('console', message =>
      message.text().startsWith('[fixture] denied userGesture autoFired'),
    );
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=gesture`);
    await refused;
    const frame = appFrame(page);

    // The effect ran on mount, with no user gesture: -32015 ActionNeedsUserGesture.
    await expect(frame.getByTestId('auto')).toHaveText('-32015');
    expect(await page.evaluate(() => window.fixture.actions)).toEqual([]);
    expect(await page.evaluate(() => window.fixture.denied)).toEqual([
      expect.objectContaining({
        type: 'denied',
        frameId: 'gesture/root',
        reason: 'userGesture',
        method: 'action/dispatch',
        target: 'autoFired',
        code: -32015,
      }),
    ]);

    // A click in the app frame activates the host page too, so this one passes.
    await frame.getByRole('button', {name: 'Send'}).click();
    await expect.poll(() => page.evaluate(() => window.fixture.actions.length)).toBe(1);
    expect((await page.evaluate(() => window.fixture.actions))[0]).toEqual(
      expect.objectContaining({name: 'clicked', sourceComponentId: 'root', context: {by: 'user'}}),
    );
  });

  test('reports an app crash to the agent once, as a v1.0 error message', async ({page}) => {
    await page.goto(`/?runtime=${encodeURIComponent(RUNTIME_ORIGIN)}&example=crash`);

    await expect.poll(() => page.evaluate(() => window.fixture.agentErrors.length)).toBe(1);
    const [message] = await page.evaluate(() => window.fixture.agentErrors);
    expect(message).toEqual({
      version: '1.0',
      error: expect.objectContaining({
        code: 'REACT_APP_ERROR',
        surfaceId: 'crash',
        componentId: 'root',
        phase: 'render',
        message: expect.stringContaining('The app broke on purpose.'),
      }),
    });
    // The DOM event still fires, and later errors of the same document don't reach the agent.
    expect((await page.evaluate(() => window.fixture.errors)).length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.fixture.agentErrors.length)).toBe(1);
  });
});
