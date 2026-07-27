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
 * CheckBox component fixtures for visual parity testing.
 *
 * A2UI CheckBox requires binding via path (not literalBoolean).
 * The value is read from the data model and two-way bound.
 */

import type {ComponentFixture} from '../types';

export const checkboxUnchecked: ComponentFixture = {
  root: 'cb-1',
  data: {
    '/checkbox/unchecked': false,
  },
  components: [
    {
      id: 'cb-1',
      component: {
        CheckBox: {
          label: {literalString: 'Unchecked option'},
          value: {path: '/checkbox/unchecked'},
        },
      },
    },
  ],
};

export const checkboxChecked: ComponentFixture = {
  root: 'cb-2',
  data: {
    '/checkbox/checked': true,
  },
  components: [
    {
      id: 'cb-2',
      component: {
        CheckBox: {
          label: {literalString: 'Checked option'},
          value: {path: '/checkbox/checked'},
        },
      },
    },
  ],
};

export const checkboxLongLabel: ComponentFixture = {
  root: 'cb-long',
  data: {
    '/checkbox/longLabel': false,
  },
  components: [
    {
      id: 'cb-long',
      component: {
        CheckBox: {
          label: {
            literalString: 'I agree to the terms and conditions of service and privacy policy',
          },
          value: {path: '/checkbox/longLabel'},
        },
      },
    },
  ],
};

export const checkboxFixtures = {
  checkboxUnchecked,
  checkboxChecked,
  checkboxLongLabel,
};
