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

/**
 * Slider component fixtures for visual parity testing.
 *
 * Note: label is not part of the standard A2UI Slider specification.
 * Using path bindings for values to match the A2UI data model pattern.
 */

import type {ComponentFixture} from '../types';

export const slider: ComponentFixture = {
  root: 'slider-1',
  data: {
    '/slider/value': 50,
  },
  components: [
    {
      id: 'slider-1',
      component: {
        Slider: {
          value: {path: '/slider/value'},
          minValue: 0,
          maxValue: 100,
        },
      },
    },
  ],
};

export const sliderFixtures = {
  slider,
};
