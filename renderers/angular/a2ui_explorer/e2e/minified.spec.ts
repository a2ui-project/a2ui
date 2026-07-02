import {test, expect, Page} from '@playwright/test';

function setupErrorMonitoring(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore offline network errors from external font/resource loading in sandboxed test environments
      if (!text.includes('ERR_INTERNET_DISCONNECTED') && !text.includes('ERR_NAME_NOT_RESOLVED')) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  return errors;
}

async function expectNoErrors(page: Page, errors: string[]): Promise<void> {
  // Let Angular update the DOM after state changes, and the browser to flush console errors.
  await page.waitForTimeout(50);
  expect(errors).toEqual([]);
}

test('renders dynamic component inputs correctly in minified production build', async ({page}) => {
  const errors = setupErrorMonitoring(page);

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Simple Text' example in sidebar
  await page.locator('.sidebar .example-list li', {hasText: 'Simple Text'}).click();

  // Check that there are no console errors immediately after action
  await expectNoErrors(page, errors);

  // In production builds with unquoted keys, the props object passed to NgComponentOutlet
  // gets minified (e.g. { a: props }), causing inputs to be silently ignored.
  // When props are ignored, the text component renders empty instead of 'Hello, Minimal Catalog!'.
  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('Hello, Minimal Catalog!');
  await expectNoErrors(page, errors);
});

test('supports interactive forms, updateDataModel, and two-way data binding in minified production build', async ({
  page,
}) => {
  const errors = setupErrorMonitoring(page);

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Login Form with Validation' example in sidebar, which explicitly sends updateDataModel
  await page.locator('.sidebar .example-list li', {hasText: 'Login Form with Validation'}).click();
  await expectNoErrors(page, errors);

  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('Welcome back');

  // Exercise two-way data binding by typing into email and password fields
  const emailInput = page.locator('.rendered-content input').first();
  await emailInput.fill('user@example.com');

  const passwordInput = page.locator('.rendered-content input[type="password"]');
  await passwordInput.fill('securepass123');

  // Trigger interactive action dispatch
  await page.locator('.rendered-content button', {hasText: 'Sign in'}).click();

  // Verify no runtime errors occurred during updateDataModel or interaction
  await expectNoErrors(page, errors);
});

test('supports string formatting and dynamic function evaluation in minified production build', async ({
  page,
}) => {
  const errors = setupErrorMonitoring(page);

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Formatted Text' example in sidebar
  await page.locator('.sidebar .example-list li', {hasText: 'Formatted Text'}).click();
  await expectNoErrors(page, errors);

  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('Type something:');

  const input = page.locator('.rendered-content input').first();
  await input.fill('hello world');

  await expect(canvas).toContainText('You typed: hello world');
  await expectNoErrors(page, errors);
});

test('populates events log correctly when interacting with buttons in minified production build', async ({
  page,
}) => {
  const errors = setupErrorMonitoring(page);

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Interactive Button' example in sidebar
  await page.locator('.sidebar .example-list li', {hasText: 'Interactive Button'}).click();
  await expectNoErrors(page, errors);

  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('Click the button below');

  // Click the button inside the rendered component
  await page.locator('.rendered-content button', {hasText: 'Click Me'}).click();
  await expectNoErrors(page, errors);

  // Verify that an event was recorded and displayed with valid details in the log
  const logItem = page.locator('.events-section .log-item').first();
  await expect(logItem).toBeVisible();

  console.log('LOG ITEM HTML:', await logItem.innerHTML());
  console.log('LOG DETAILS:', await logItem.locator('.log-details').textContent());

  const logType = logItem.locator('.log-type');
  await expect(logType).toContainText('button_clicked');

  const logDetails = logItem.locator('.log-details');
  await expect(logDetails).toContainText('"name": "button_clicked"');
  await expect(logDetails).toContainText('"surfaceId": "gallery-interactive-button"');
  await expect(logDetails).toContainText('"sourceComponentId": "action_button"');
  await expectNoErrors(page, errors);
});

test('renders Weather Current with date formatting in minified production build', async ({
  page,
}) => {
  const errors = setupErrorMonitoring(page);
  page.on('console', msg => console.log('CON:', msg.type(), msg.text()));

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Weather Current' example in sidebar
  await page.locator('.sidebar .example-list li', {hasText: 'Weather Current'}).click();
  await expectNoErrors(page, errors);

  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('Austin, TX');

  // Check that day names (from formatDate function call) are rendered
  const hasDayName = await canvas.evaluate(el => {
    const text = el.textContent || '';
    return (
      text.includes('Tue') ||
      text.includes('Wed') ||
      text.includes('Thu') ||
      text.includes('Fri') ||
      text.includes('Sat') ||
      text.includes('Sun') ||
      text.includes('Mon')
    );
  });
  expect(hasDayName).toBeTruthy();
  await expectNoErrors(page, errors);
});

test('renders Incremental example without errors in minified production build', async ({page}) => {
  const errors = setupErrorMonitoring(page);

  await page.goto('/');
  await expectNoErrors(page, errors);

  // Click on 'Incremental' example in sidebar
  await page.locator('.sidebar .example-list li').filter({has: page.locator('.ex-name', {hasText: /^Incremental$/})}).click();
  await expectNoErrors(page, errors);

  const canvas = page.locator('.rendered-content');
  await expect(canvas).toContainText('The Golden Fork');
  await expect(canvas).toContainText("Ocean's Bounty");
  await expect(canvas).toContainText('Pizzeria Roma');
  await expectNoErrors(page, errors);
});
