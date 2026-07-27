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
 * DateTimeInput component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const dateTimeInputDate: ComponentFixture = {
  root: 'dt-date',
  components: [
    {
      id: 'dt-date',
      component: {
        DateTimeInput: {
          value: {literalString: '2025-02-15'},
          enableDate: true,
          enableTime: false,
        },
      },
    },
  ],
};

export const dateTimeInputTime: ComponentFixture = {
  root: 'dt-time',
  components: [
    {
      id: 'dt-time',
      component: {
        DateTimeInput: {
          value: {literalString: '14:30'},
          enableDate: false,
          enableTime: true,
        },
      },
    },
  ],
};

export const dateTimeInputBoth: ComponentFixture = {
  root: 'dt-both',
  components: [
    {
      id: 'dt-both',
      component: {
        DateTimeInput: {
          value: {literalString: '2025-02-15T14:30'},
          enableDate: true,
          enableTime: true,
        },
      },
    },
  ],
};

export const dateTimeInputFixtures = {
  dateTimeInputDate,
  dateTimeInputTime,
  dateTimeInputBoth,
};
