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

import {ApplicationRef} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {getCanvas, loadExample, wait, Version} from '../utils';

for (const useUniversal of [false, true]) {
  describe(`Example: Native Angular Grid (useUniversalComponents: ${useUniversal})`, () => {
    let canvas: HTMLElement;

    beforeEach(async () => {
      await loadExample('Native Grid', {
        version: Version.V0_9,
        useUniversalComponents: useUniversal,
      });
      await wait(50);
      TestBed.inject(ApplicationRef).tick();
      canvas = getCanvas();
    });

    it('should render the native Angular container component and header content', () => {
      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Native Container Component Showcase');
      expect(textContent).toContain('Interactive 2x2 Component Grid');
      expect(
        canvas.querySelector('a2ui-custom-grid') || canvas.querySelector('a2ui-ng-customgrid'),
      ).toBeTruthy();
    });

    it('should instantiate native Angular component children (CustomSlider)', () => {
      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Master Volume (Native)');
      expect(textContent).toContain('Brightness Level (Native)');

      const customSliders = canvas.querySelectorAll('a2ui-custom-slider, a2ui-ng-customslider');
      expect(customSliders.length).toBe(2);
    });

    it('should instantiate universal web component children (Card, Text, Button)', () => {
      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Universal Web Component: Text & Card');
      expect(textContent).toContain('Universal Button Action');

      expect(
        canvas.querySelector('a2ui-v09-card') ||
          canvas.querySelector('a2ui-card') ||
          canvas.querySelector('a2ui-basic-card'),
      ).toBeTruthy();
      expect(
        canvas.querySelector('a2ui-v09-button') ||
          canvas.querySelector('a2ui-basic-button') ||
          canvas.querySelector('a2ui-button'),
      ).toBeTruthy();
    });

    it('should update reactive data binding across native and universal components', async () => {
      const slider = (canvas.querySelector('a2ui-custom-slider input[type="range"]') ||
        canvas.querySelector('a2ui-ng-customslider input[type="range"]') ||
        canvas.querySelector('input[type="range"]')) as HTMLInputElement;
      expect(slider).toBeTruthy();

      slider.value = '80';
      slider.dispatchEvent(new Event('input'));
      await wait(50);
      TestBed.inject(ApplicationRef).tick();

      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Vol: 80% | Bright: 30%');
    });
  });
}
