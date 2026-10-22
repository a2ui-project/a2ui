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
  // With universal components on, the basic catalog renders web_core's
  // elements and every other Angular component renders in its
  // `a2ui-ng-<name>` host element; off, each renders as its own selector.
  const tag = useUniversal
    ? {
        grid: 'a2ui-ng-customgrid',
        slider: 'a2ui-ng-customslider',
        card: 'a2ui-card',
        button: 'a2ui-basic-button',
      }
    : {
        grid: 'a2ui-custom-grid',
        slider: 'a2ui-custom-slider',
        card: 'a2ui-v09-card',
        button: 'a2ui-v09-button',
      };

  describe(`Example: Native Angular Grid (useUniversalComponents: ${useUniversal})`, () => {
    let canvas: HTMLElement;

    beforeEach(async () => {
      await loadExample({
        name: 'Native Grid',
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
      expect(canvas.querySelector(tag.grid)).toBeTruthy();
    });

    it('should instantiate native Angular component children (CustomSlider)', () => {
      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Master Volume (Native)');
      expect(textContent).toContain('Brightness Level (Native)');

      const customSliders = canvas.querySelectorAll(tag.slider);
      expect(customSliders.length).toBe(3);
    });

    it('should host a native component inside a universal component', async () => {
      const nested = canvas.querySelectorAll(`${tag.card} ${tag.slider}`);
      expect(nested.length).toBe(1);
      expect(nested[0].textContent).toContain('Contrast (Native, inside universal Card)');

      const slider = nested[0].querySelector('input[type="range"]') as HTMLInputElement;
      slider.value = '80';
      slider.dispatchEvent(new Event('input'));
      await wait(50);
      TestBed.inject(ApplicationRef).tick();

      expect(canvas.textContent || '').toContain('Contrast: 80%');
    });

    it('should instantiate universal web component children (Card, Text, Button)', () => {
      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Universal Web Component: Text & Card');
      expect(textContent).toContain('Universal Button Action');

      expect(canvas.querySelector(tag.card)).toBeTruthy();
      expect(canvas.querySelector(tag.button)).toBeTruthy();
    });

    it('should update reactive data binding across native and universal components', async () => {
      const [volume] = Array.from(canvas.querySelectorAll(tag.slider));
      expect(volume.textContent).toContain('Master Volume (Native)');
      const slider = volume.querySelector('input[type="range"]') as HTMLInputElement;

      slider.value = '80';
      slider.dispatchEvent(new Event('input'));
      await wait(50);
      TestBed.inject(ApplicationRef).tick();

      const textContent = canvas.textContent || '';
      expect(textContent).toContain('Vol: 80% | Bright: 30%');
    });
  });
}
