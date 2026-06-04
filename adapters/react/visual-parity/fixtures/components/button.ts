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
 * Button component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const buttonPrimary: ComponentFixture = {
  root: 'btn-1',
  components: [
    {
      id: 'btn-text',
      component: {
        Text: {text: {literalString: 'Primary Button'}},
      },
    },
    {
      id: 'btn-1',
      component: {
        Button: {child: 'btn-text', action: {name: 'click'}, primary: true},
      },
    },
  ],
};

export const buttonSecondary: ComponentFixture = {
  root: 'btn-2',
  components: [
    {
      id: 'btn-text-2',
      component: {
        Text: {text: {literalString: 'Secondary Button'}},
      },
    },
    {
      id: 'btn-2',
      component: {
        Button: {child: 'btn-text-2', action: {name: 'click'}, primary: false},
      },
    },
  ],
};

export const buttonWithIcon: ComponentFixture = {
  root: 'btn-icon',
  components: [
    {
      id: 'btn-icon-icon',
      component: {
        Icon: {name: {literalString: 'add'}},
      },
    },
    {
      id: 'btn-icon-text',
      component: {
        Text: {text: {literalString: 'Add Item'}},
      },
    },
    {
      id: 'btn-icon-row',
      component: {
        Row: {children: {explicitList: ['btn-icon-icon', 'btn-icon-text']}},
      },
    },
    {
      id: 'btn-icon',
      component: {
        Button: {child: 'btn-icon-row', action: {name: 'add'}, primary: true},
      },
    },
  ],
};

export const buttonFixtures = {
  buttonPrimary,
  buttonSecondary,
  buttonWithIcon,
};
