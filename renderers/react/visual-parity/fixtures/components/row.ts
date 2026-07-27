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
 * Row component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const row: ComponentFixture = {
  root: 'row-1',
  components: [
    {id: 'row-icon-1', component: {Icon: {name: {literalString: 'home'}}}},
    {id: 'row-icon-2', component: {Icon: {name: {literalString: 'search'}}}},
    {id: 'row-icon-3', component: {Icon: {name: {literalString: 'settings'}}}},
    {
      id: 'row-1',
      component: {
        Row: {children: {explicitList: ['row-icon-1', 'row-icon-2', 'row-icon-3']}},
      },
    },
  ],
};

export const rowWithText: ComponentFixture = {
  root: 'row-text',
  components: [
    {id: 'row-text-1', component: {Text: {text: {literalString: 'First'}}}},
    {id: 'row-text-2', component: {Text: {text: {literalString: 'Second'}}}},
    {id: 'row-text-3', component: {Text: {text: {literalString: 'Third'}}}},
    {
      id: 'row-text',
      component: {
        Row: {children: {explicitList: ['row-text-1', 'row-text-2', 'row-text-3']}},
      },
    },
  ],
};

export const rowStart: ComponentFixture = {
  root: 'row-start',
  components: [
    {id: 'row-start-1', component: {Text: {text: {literalString: 'A'}}}},
    {id: 'row-start-2', component: {Text: {text: {literalString: 'B'}}}},
    {id: 'row-start-3', component: {Text: {text: {literalString: 'C'}}}},
    {
      id: 'row-start',
      component: {
        Row: {
          children: {explicitList: ['row-start-1', 'row-start-2', 'row-start-3']},
          distribution: 'start',
        },
      },
    },
  ],
};

export const rowCenter: ComponentFixture = {
  root: 'row-center',
  components: [
    {id: 'row-center-1', component: {Text: {text: {literalString: 'A'}}}},
    {id: 'row-center-2', component: {Text: {text: {literalString: 'B'}}}},
    {id: 'row-center-3', component: {Text: {text: {literalString: 'C'}}}},
    {
      id: 'row-center',
      component: {
        Row: {
          children: {explicitList: ['row-center-1', 'row-center-2', 'row-center-3']},
          distribution: 'center',
        },
      },
    },
  ],
};

export const rowEnd: ComponentFixture = {
  root: 'row-end',
  components: [
    {id: 'row-end-1', component: {Text: {text: {literalString: 'A'}}}},
    {id: 'row-end-2', component: {Text: {text: {literalString: 'B'}}}},
    {id: 'row-end-3', component: {Text: {text: {literalString: 'C'}}}},
    {
      id: 'row-end',
      component: {
        Row: {
          children: {explicitList: ['row-end-1', 'row-end-2', 'row-end-3']},
          distribution: 'end',
        },
      },
    },
  ],
};

export const rowSpaceBetween: ComponentFixture = {
  root: 'row-space',
  components: [
    {id: 'row-space-1', component: {Text: {text: {literalString: 'Left'}}}},
    {id: 'row-space-2', component: {Text: {text: {literalString: 'Center'}}}},
    {id: 'row-space-3', component: {Text: {text: {literalString: 'Right'}}}},
    {
      id: 'row-space',
      component: {
        Row: {
          children: {explicitList: ['row-space-1', 'row-space-2', 'row-space-3']},
          distribution: 'spaceBetween',
        },
      },
    },
  ],
};

export const rowFixtures = {
  row,
  rowWithText,
  rowStart,
  rowCenter,
  rowEnd,
  rowSpaceBetween,
};
