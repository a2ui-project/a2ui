/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {test, expect} from '@playwright/test';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {allFixtures, fixtureNames, type FixtureName} from '../fixtures';
import {themeNames, type ThemeName} from '../fixtures/themes';

/**
 * Visual parity tests for A2UI React vs Lit renderers.
 *
 * These tests compare screenshots of the same component fixtures rendered by
 * both React and Lit to ensure visual consistency between the two renderers.
 *
 * Strategy:
 * - Lit is treated as the "reference" implementation
 * - React screenshots are compared DIRECTLY against Lit screenshots (in memory)
 * - Tests fail if the pixel difference exceeds the threshold
 * - Tests run across multiple themes to ensure theme switching works correctly
 * - No baseline snapshots are saved - comparison is always live Lit vs React
 */

const REACT_BASE_URL = 'http://localhost:5001';
const LIT_BASE_URL = 'http://localhost:5002';

// Strict threshold for visual parity
// 0.01 = 1% color difference tolerance per pixel (very strict)
// This catches subtle color differences while allowing minor anti-aliasing variance
const PIXEL_DIFF_THRESHOLD = 0.01;

// Maximum allowed different pixels (as percentage of total)
const MAX_DIFF_PERCENT = 1; // 1% of pixels can differ

/**
 * Fixtures to skip in visual parity tests.
 */
const skippedFixtures: FixtureName[] = [];

/**
 * Get fixtures to test (excluding skipped ones).
 */
const fixturesToTest = fixtureNames.filter(name => !skippedFixtures.includes(name));

/**
 * Themes to test for visual parity.
 * - lit: The litTheme from @a2ui/react
 * - visualParity: Alternate theme
 * - minimal: Stripped-down theme
 *
 * Note: 'default' (undefined theme) is excluded because Lit crashes when no theme
 * is provided - it accesses this.theme.components without a fallback.
 */
const themesToTest: ThemeName[] = ['lit', 'visualParity', 'minimal'];

/**
 * Compare two PNG buffers and return the number of different pixels.
 */
function compareImages(
  img1Buffer: Buffer,
  img2Buffer: Buffer,
): {diffPixels: number; totalPixels: number; diffPercent: number} {
  const img1 = PNG.sync.read(img1Buffer);
  const img2 = PNG.sync.read(img2Buffer);

  // Images must be the same size for comparison
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return {
      diffPixels: -1,
      totalPixels: img1.width * img1.height,
      diffPercent: 100, // Size mismatch = 100% different
    };
  }

  const totalPixels = img1.width * img1.height;
  const diffPixels = pixelmatch(
    img1.data,
    img2.data,
    null, // Don't generate diff image
    img1.width,
    img1.height,
    {threshold: PIXEL_DIFF_THRESHOLD},
  );

  return {
    diffPixels,
    totalPixels,
    diffPercent: (diffPixels / totalPixels) * 100,
  };
}

/**
 * Build URL with fixture and optional theme parameters.
 */
function buildUrl(baseUrl: string, fixture: string, theme?: string): string {
  const params = new URLSearchParams({fixture});
  if (theme && theme !== 'default') {
    params.set('theme', theme);
  }
  return `${baseUrl}?${params.toString()}`;
}

// =============================================================================
// Main Visual Parity Tests (All Themes)
// =============================================================================

test.describe('Visual Parity: React vs Lit', () => {
  for (const theme of themesToTest) {
    test.describe(`Theme: ${theme}`, () => {
      for (const fixture of fixturesToTest) {
        test(`${fixture}`, async ({browser}) => {
          // Use separate contexts to avoid any state leakage between renderers
          const litContext = await browser.newContext();
          const reactContext = await browser.newContext();

          try {
            const litPage = await litContext.newPage();
            const reactPage = await reactContext.newPage();

            // Build URLs with theme parameter
            const litUrl = buildUrl(LIT_BASE_URL, fixture, theme);
            const reactUrl = buildUrl(REACT_BASE_URL, fixture, theme);

            // Screenshot Lit (reference)
            await litPage.goto(litUrl);
            await litPage.waitForSelector('.fixture-container', {state: 'visible'});
            await litPage.waitForLoadState('networkidle');
            // Wait for fonts to load (important for text rendering parity)
            await litPage.evaluate(() => document.fonts.ready);
            const litContainer = litPage.locator('.fixture-container');
            const litScreenshot = await litContainer.screenshot();

            // Screenshot React (test subject)
            await reactPage.goto(reactUrl);
            await reactPage.waitForSelector('.fixture-container', {state: 'visible'});
            await reactPage.waitForLoadState('networkidle');
            // Wait for fonts to load
            await reactPage.evaluate(() => document.fonts.ready);
            const reactContainer = reactPage.locator('.fixture-container');
            const reactScreenshot = await reactContainer.screenshot();

            // Direct comparison: React vs Lit
            const {diffPixels, totalPixels, diffPercent} = compareImages(
              reactScreenshot,
              litScreenshot,
            );

            // Report the difference
            console.log(
              `[${theme}] ${fixture}: ${diffPixels}/${totalPixels} pixels differ (${diffPercent.toFixed(2)}%)`,
            );

            // Fail if difference exceeds threshold
            expect(
              diffPercent,
              `[Theme: ${theme}] React and Lit differ by ${diffPercent.toFixed(2)}% (${diffPixels} pixels). ` +
                `Max allowed: ${MAX_DIFF_PERCENT}%`,
            ).toBeLessThanOrEqual(MAX_DIFF_PERCENT);
          } finally {
            await litContext.close();
            await reactContext.close();
          }
        });
      }
    });
  }
});

// =============================================================================
// Debug Tests
// =============================================================================

test.describe('DOM Structure Debug', () => {
  test('debug - compare dimensions', async ({browser}) => {
    const fixture = 'buttonPrimary'; // Change this to test different fixtures
    const theme = 'lit';
    const litContext = await browser.newContext();
    const reactContext = await browser.newContext();

    try {
      const litPage = await litContext.newPage();
      const reactPage = await reactContext.newPage();

      // Get Lit dimensions
      const litUrl = buildUrl(LIT_BASE_URL, fixture, theme);
      await litPage.goto(litUrl);
      await litPage.waitForSelector('.fixture-container', {state: 'visible'});
      await litPage.waitForLoadState('networkidle');
      await litPage.evaluate(() => document.fonts.ready);

      const litDimensions = await litPage.evaluate(() => {
        const container = document.querySelector('.fixture-container');
        const rect = container?.getBoundingClientRect();

        // Navigate through nested shadow DOMs: themed-a2ui-surface -> a2ui-surface -> a2ui-button
        // Note: a2ui-root just uses <slot>, so children are in surface's shadow DOM
        const themedSurface = document.querySelector('themed-a2ui-surface');
        const themedShadow = themedSurface?.shadowRoot;
        const surface = themedShadow?.querySelector('a2ui-surface');
        const surfaceShadow = surface?.shadowRoot;
        // Button is a direct descendant in surface's shadow DOM (root is just a slot wrapper)
        const button = surfaceShadow?.querySelector('a2ui-button');
        const buttonShadow = button?.shadowRoot;
        const buttonEl = buttonShadow?.querySelector('button');
        const buttonStyle = buttonEl ? window.getComputedStyle(buttonEl) : null;

        // Text is in button's light DOM (passed as child), not shadow DOM
        const textEl = button?.querySelector('a2ui-text');
        const textShadow = textEl?.shadowRoot;
        const textSection = textShadow?.querySelector('section');
        const pEl = textShadow?.querySelector('p');
        const textStyle = textSection ? window.getComputedStyle(textSection) : null;
        const pStyle = pEl ? window.getComputedStyle(pEl) : null;

        // Check CSS variable value at themed-surface level
        const cssVarP100 = themedSurface
          ? getComputedStyle(themedSurface).getPropertyValue('--p-100')
          : 'N/A';

        // Check CSS variable values at different levels
        const pComputedStyle = pEl ? getComputedStyle(pEl) : null;
        const cssVarN10AtP = pComputedStyle?.getPropertyValue('--n-10') ?? 'N/A';
        const cssVarN90AtP = pComputedStyle?.getPropertyValue('--n-90') ?? 'N/A';

        return {
          width: rect?.width,
          height: rect?.height,
          buttonColor: buttonStyle?.color,
          buttonBgColor: buttonStyle?.backgroundColor,
          textSectionColor: textStyle?.color,
          pColor: pStyle?.color,
          cssVarP100,
          cssVarN10AtP,
          cssVarN90AtP,
        };
      });

      // Get React dimensions
      const reactUrl = buildUrl(REACT_BASE_URL, fixture, theme);
      await reactPage.goto(reactUrl);
      await reactPage.waitForSelector('.fixture-container', {state: 'visible'});
      await reactPage.waitForLoadState('networkidle');
      await reactPage.evaluate(() => document.fonts.ready);

      const reactDimensions = await reactPage.evaluate(() => {
        const container = document.querySelector('.fixture-container');
        const rect = container?.getBoundingClientRect();

        // Get button and text colors in React (Light DOM)
        const buttonEl = document.querySelector('.a2ui-surface button');
        const buttonStyle = buttonEl ? window.getComputedStyle(buttonEl) : null;
        const textSection = buttonEl?.querySelector('section');
        const pEl = buttonEl?.querySelector('p');
        const textStyle = textSection ? window.getComputedStyle(textSection) : null;
        const pStyle = pEl ? window.getComputedStyle(pEl) : null;

        // Check CSS variable values from within the surface element (where they're scoped)
        const surfaceEl = document.querySelector('.a2ui-surface');
        const surfaceStyle = surfaceEl ? getComputedStyle(surfaceEl) : null;
        const cssVarN10 = surfaceStyle?.getPropertyValue('--n-10') ?? 'N/A';
        const cssVarP100 = surfaceStyle?.getPropertyValue('--p-100') ?? 'N/A';

        // Also check from paragraph element
        const pCssVarN10 = pStyle?.getPropertyValue('--n-10') ?? 'N/A';

        // Check the actual class list on the paragraph
        const pClassList = pEl?.className ?? 'no p element';

        // Test if the CSS rule is actually being applied
        const testDiv = document.createElement('div');
        testDiv.className = 'a2ui-surface';
        testDiv.innerHTML = '<p class="color-c-n10" style=""></p>';
        document.body.appendChild(testDiv);
        const testP = testDiv.querySelector('p');
        const testPColor = testP ? getComputedStyle(testP).color : 'N/A';
        document.body.removeChild(testDiv);

        // Check for inline styles on the paragraph
        const pInlineStyle = pEl?.getAttribute('style') ?? 'none';

        // Get the HTML around the paragraph to see the structure
        const buttonHtml = buttonEl?.innerHTML?.slice(0, 500) ?? 'N/A';

        // Check if there are any rules that match our paragraph AND set color
        const matchingRulesForP: string[] = [];
        if (pEl) {
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                if (rule instanceof CSSStyleRule) {
                  // Check if this rule matches our paragraph
                  try {
                    if (pEl.matches(rule.selectorText) && rule.style.color) {
                      matchingRulesForP.push(`${rule.selectorText} -> color: ${rule.style.color}`);
                    }
                  } catch (e) {
                    // Invalid selector
                  }
                }
              }
            } catch (e) {
              // Cross-origin stylesheets can't be accessed
            }
          }
        }

        return {
          width: rect?.width,
          height: rect?.height,
          buttonColor: buttonStyle?.color,
          pColor: pStyle?.color,
          testPColor,
          matchingRulesForP: matchingRulesForP.slice(0, 15),
        };
      });

      console.log(`\n=== ${fixture} (theme: ${theme}) Dimensions ===`);
      console.log('Lit:', JSON.stringify(litDimensions, null, 2));
      console.log('React:', JSON.stringify(reactDimensions, null, 2));

      expect(true).toBe(true);
    } finally {
      await litContext.close();
      await reactContext.close();
    }
  });

  test('debug - compare DOM', async ({page}) => {
    const fixture = 'dividerHorizontal';
    const theme = 'lit';

    // Capture console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      errors.push(err.message);
    });

    // Get Lit DOM - also check shadow DOM
    const litUrl = buildUrl(LIT_BASE_URL, fixture, theme);
    await page.goto(litUrl);
    await page.waitForSelector('.fixture-container', {state: 'attached'});
    await page.waitForTimeout(1000);
    const litHtml = await page.locator('.fixture-container').innerHTML();

    // Check a2ui-surface shadow DOM content
    const litDebug = await page.evaluate(() => {
      const surface = document.querySelector('a2ui-surface');
      const surfaceShadow = surface?.shadowRoot?.innerHTML ?? 'no shadow root';

      // Check for root element
      const rootEl = surface?.shadowRoot?.querySelector('a2ui-root');
      const rootShadow = rootEl?.shadowRoot?.innerHTML ?? 'no root shadow';

      // Check for divider element
      const dividerEl =
        rootEl?.shadowRoot?.querySelector('a2ui-divider') ??
        surface?.shadowRoot?.querySelector('a2ui-divider');
      const dividerShadow = dividerEl?.shadowRoot?.innerHTML ?? 'no divider shadow root';

      // Get computed styles of the hr element
      const hrEl = dividerEl?.shadowRoot?.querySelector('hr');
      const hrStyle = hrEl ? window.getComputedStyle(hrEl) : null;
      const containerStyle = document.querySelector('.fixture-container');
      const containerComputed = containerStyle ? window.getComputedStyle(containerStyle) : null;

      const litStyles = {
        hrHeight: hrStyle?.height,
        hrWidth: hrStyle?.width,
        hrDisplay: hrStyle?.display,
        hrBackground: hrStyle?.background,
        containerDisplay: containerComputed?.display,
        containerWidth: containerComputed?.width,
        containerHeight: containerComputed?.height,
      };

      return {surfaceShadow, rootShadow, dividerShadow, litStyles};
    });

    // Get React DOM
    const reactUrl = buildUrl(REACT_BASE_URL, fixture, theme);
    await page.goto(reactUrl);
    await page.waitForSelector('.fixture-container', {state: 'visible'});
    await page.waitForTimeout(500);
    const reactHtml = await page.locator('.fixture-container').innerHTML();

    // Get React computed styles
    const reactStyles = await page.evaluate(() => {
      const sectionEl = document.querySelector('.a2ui-surface section');
      const h1El = document.querySelector('.a2ui-surface h1');
      const computedStyle = sectionEl ? window.getComputedStyle(sectionEl) : null;
      const h1Style = h1El ? window.getComputedStyle(h1El) : null;
      return {
        fontFamily: computedStyle?.fontFamily,
        fontSize: computedStyle?.fontSize,
        lineHeight: computedStyle?.lineHeight,
        color: computedStyle?.color,
        sectionMargin: computedStyle?.margin,
        h1Margin: h1Style?.margin,
        h1FontSize: h1Style?.fontSize,
      };
    });

    console.log('\n=== Lit Console Errors ===');
    console.log(errors.length ? errors.join('\n') : 'No errors');
    console.log('\n=== Lit DOM (light) ===');
    console.log(litHtml);
    console.log('\n=== Lit Surface Shadow DOM ===');
    console.log(litDebug.surfaceShadow);
    console.log('\n=== Lit Root Shadow DOM ===');
    console.log(litDebug.rootShadow);
    console.log('\n=== Lit Divider Shadow DOM ===');
    console.log(litDebug.dividerShadow);
    console.log('\n=== Lit Computed Styles ===');
    console.log(JSON.stringify(litDebug.litStyles, null, 2));
    console.log('\n=== React DOM ===');
    console.log(reactHtml);
    console.log('\n=== React Computed Styles ===');
    console.log(JSON.stringify(reactStyles, null, 2));

    // This test always passes - it's just for debugging
    expect(true).toBe(true);
  });

  test('debug - list all fixtures', async () => {
    console.log('\n=== All Fixtures ===');
    console.log(`Total: ${fixtureNames.length} fixtures`);
    console.log(`Skipped: ${skippedFixtures.length} (${skippedFixtures.join(', ')})`);
    console.log(`Testing: ${fixturesToTest.length} fixtures`);
    console.log('\nFixtures:');
    fixtureNames.forEach((name, i) => {
      const skipped = skippedFixtures.includes(name) ? ' [SKIPPED]' : '';
      console.log(`  ${i + 1}. ${name}${skipped}`);
    });
    console.log('\n=== Themes ===');
    console.log(`Testing: ${themesToTest.length} themes`);
    themesToTest.forEach(theme => {
      console.log(`  - ${theme}`);
    });
    console.log(
      `\nTotal test cases: ${fixturesToTest.length} fixtures x ${themesToTest.length} themes = ${fixturesToTest.length * themesToTest.length}`,
    );
    expect(true).toBe(true);
  });
});
