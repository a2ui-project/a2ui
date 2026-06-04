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
 * Icon component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const icon: ComponentFixture = {
  root: 'icon-1',
  components: [
    {
      id: 'icon-1',
      component: {
        Icon: {name: {literalString: 'home'}},
      },
    },
  ],
};

export const iconMultiple: ComponentFixture = {
  root: 'icons-row',
  components: [
    {id: 'icon-home', component: {Icon: {name: {literalString: 'home'}}}},
    {id: 'icon-search', component: {Icon: {name: {literalString: 'search'}}}},
    {id: 'icon-settings', component: {Icon: {name: {literalString: 'settings'}}}},
    {id: 'icon-favorite', component: {Icon: {name: {literalString: 'favorite'}}}},
    {id: 'icon-star', component: {Icon: {name: {literalString: 'star'}}}},
    {
      id: 'icons-row',
      component: {
        Row: {
          children: {
            explicitList: [
              'icon-home',
              'icon-search',
              'icon-settings',
              'icon-favorite',
              'icon-star',
            ],
          },
        },
      },
    },
  ],
};

export const iconFixtures = {
  icon,
  iconMultiple,
};
