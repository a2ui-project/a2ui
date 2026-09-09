/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert';
import {describe, it, before, after} from 'node:test';
import {setupTestDom, teardownTestDom} from '../../test/dom-setup.js';
import {
  injectBasicCatalogStyles as rootInjectBasicCatalogStyles,
  computeColorVariant as rootComputeColorVariant,
  type ColorVariantLightDarkOptions,
  type ColorVariantHoverOptions,
} from '../../index.js';
import {injectBasicCatalogStyles, computeColorVariant} from './default.js';

describe('Basic Catalog Styles & Helpers', () => {
  describe('Public API Exports from @a2ui/web_core/v0_9', () => {
    it('exports injectBasicCatalogStyles and computeColorVariant from root v0_9 entrypoint', () => {
      assert.strictEqual(typeof rootInjectBasicCatalogStyles, 'function');
      assert.strictEqual(typeof rootComputeColorVariant, 'function');
      assert.strictEqual(rootInjectBasicCatalogStyles, injectBasicCatalogStyles);
      assert.strictEqual(rootComputeColorVariant, computeColorVariant);
    });

    it('allows typing options with exported ColorVariantLightDarkOptions and ColorVariantHoverOptions', () => {
      const lightDarkOpt: ColorVariantLightDarkOptions = {
        colorVar: '--a2ui-color-primary',
        percentage: 90,
        mixColor: '#fff',
      };
      const hoverOpt: ColorVariantHoverOptions = {
        darkVar: '--a2ui-color-primary-dark',
        lightVar: '--a2ui-color-primary-light',
      };
      assert.strictEqual(lightDarkOpt.colorVar, '--a2ui-color-primary');
      assert.strictEqual(hoverOpt.darkVar, '--a2ui-color-primary-dark');
    });
  });

  describe('computeColorVariant', () => {
    it('computes default light variant formula with 85% and white', () => {
      const result = computeColorVariant('light', {
        colorVar: '--a2ui-color-primary',
      });
      assert.strictEqual(result, 'color-mix(in oklab, var(--a2ui-color-primary) 85%, white)');
    });

    it('computes default dark variant formula with 85% and black', () => {
      const result = computeColorVariant('dark', {
        colorVar: '--a2ui-color-primary',
      });
      assert.strictEqual(result, 'color-mix(in oklab, var(--a2ui-color-primary) 85%, black)');
    });

    it('computes light variant formula with custom percentage and mixColor', () => {
      const result = computeColorVariant('light', {
        colorVar: '--a2ui-color-secondary',
        percentage: 70,
        mixColor: '#fafafa',
      });
      assert.strictEqual(result, 'color-mix(in oklab, var(--a2ui-color-secondary) 70%, #fafafa)');
    });

    it('computes dark variant formula with custom percentage and mixColor', () => {
      const result = computeColorVariant('dark', {
        colorVar: '--a2ui-color-secondary',
        percentage: 95,
        mixColor: '#121212',
      });
      assert.strictEqual(result, 'color-mix(in oklab, var(--a2ui-color-secondary) 95%, #121212)');
    });

    it('computes hover variant formula using light-dark()', () => {
      const result = computeColorVariant('hover', {
        darkVar: '--a2ui-color-primary-dark',
        lightVar: '--a2ui-color-primary-light',
      });
      assert.strictEqual(
        result,
        'light-dark(var(--a2ui-color-primary-dark), var(--a2ui-color-primary-light))',
      );
    });
  });

  describe('injectBasicCatalogStyles', () => {
    before(() => {
      setupTestDom();
    });

    after(() => {
      teardownTestDom();
    });

    it('injects stylesheet into document.adoptedStyleSheets without error', () => {
      assert.doesNotThrow(() => {
        injectBasicCatalogStyles();
      });
      // Repeated invocation should not duplicate or throw
      assert.doesNotThrow(() => {
        injectBasicCatalogStyles();
      });
    });

    it('injects stylesheet into a ShadowRoot targetRoot', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const shadow = el.attachShadow({mode: 'open'});

      assert.doesNotThrow(() => {
        injectBasicCatalogStyles(shadow);
      });
      // Repeated invocation should not duplicate or throw
      assert.doesNotThrow(() => {
        injectBasicCatalogStyles(shadow);
      });
    });
  });
});
