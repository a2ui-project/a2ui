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
 * Column component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const column: ComponentFixture = {
  root: 'col-1',
  components: [
    {id: 'col-text-1', component: {Text: {text: {literalString: 'First item'}}}},
    {id: 'col-text-2', component: {Text: {text: {literalString: 'Second item'}}}},
    {id: 'col-text-3', component: {Text: {text: {literalString: 'Third item'}}}},
    {
      id: 'col-1',
      component: {
        Column: {children: {explicitList: ['col-text-1', 'col-text-2', 'col-text-3']}},
      },
    },
  ],
};

export const columnStart: ComponentFixture = {
  root: 'col-start',
  components: [
    {id: 'col-start-1', component: {Text: {text: {literalString: 'Top'}}}},
    {id: 'col-start-2', component: {Text: {text: {literalString: 'Middle'}}}},
    {id: 'col-start-3', component: {Text: {text: {literalString: 'Bottom'}}}},
    {
      id: 'col-start',
      component: {
        Column: {
          children: {explicitList: ['col-start-1', 'col-start-2', 'col-start-3']},
          distribution: 'start',
        },
      },
    },
  ],
};

export const columnCenter: ComponentFixture = {
  root: 'col-center',
  components: [
    {id: 'col-center-1', component: {Text: {text: {literalString: 'Top'}}}},
    {id: 'col-center-2', component: {Text: {text: {literalString: 'Middle'}}}},
    {id: 'col-center-3', component: {Text: {text: {literalString: 'Bottom'}}}},
    {
      id: 'col-center',
      component: {
        Column: {
          children: {explicitList: ['col-center-1', 'col-center-2', 'col-center-3']},
          distribution: 'center',
        },
      },
    },
  ],
};

export const columnEnd: ComponentFixture = {
  root: 'col-end',
  components: [
    {id: 'col-end-1', component: {Text: {text: {literalString: 'Top'}}}},
    {id: 'col-end-2', component: {Text: {text: {literalString: 'Middle'}}}},
    {id: 'col-end-3', component: {Text: {text: {literalString: 'Bottom'}}}},
    {
      id: 'col-end',
      component: {
        Column: {
          children: {explicitList: ['col-end-1', 'col-end-2', 'col-end-3']},
          distribution: 'end',
        },
      },
    },
  ],
};

export const columnMixed: ComponentFixture = {
  root: 'col-mixed',
  components: [
    {
      id: 'col-mixed-h',
      component: {Text: {text: {literalString: 'Section Title'}, usageHint: 'h3'}},
    },
    {
      id: 'col-mixed-body',
      component: {Text: {text: {literalString: 'Regular body text content.'}}},
    },
    {
      id: 'col-mixed-caption',
      component: {Text: {text: {literalString: 'Caption text below'}, usageHint: 'caption'}},
    },
    {
      id: 'col-mixed',
      component: {
        Column: {
          children: {explicitList: ['col-mixed-h', 'col-mixed-body', 'col-mixed-caption']},
        },
      },
    },
  ],
};

export const columnFixtures = {
  column,
  columnStart,
  columnCenter,
  columnEnd,
  columnMixed,
};
