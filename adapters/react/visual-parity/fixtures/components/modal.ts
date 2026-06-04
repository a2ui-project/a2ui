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
 * Modal component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const modalBasic: ComponentFixture = {
  root: 'modal-1',
  components: [
    {
      id: 'trigger-text',
      component: {
        Text: {text: {literalString: 'Open Modal'}},
      },
    },
    {
      id: 'trigger-btn',
      component: {
        Button: {child: 'trigger-text', action: {name: 'open'}},
      },
    },
    {
      id: 'modal-content-text',
      component: {
        Text: {text: {literalString: 'This is the modal content.'}},
      },
    },
    {
      id: 'modal-1',
      component: {
        Modal: {
          entryPointChild: 'trigger-btn',
          contentChild: 'modal-content-text',
        },
      },
    },
  ],
};

export const modalWithCard: ComponentFixture = {
  root: 'modal-2',
  components: [
    {
      id: 'trigger-text-2',
      component: {
        Text: {text: {literalString: 'Show Details'}},
      },
    },
    {
      id: 'trigger-btn-2',
      component: {
        Button: {child: 'trigger-text-2', action: {name: 'open'}, primary: true},
      },
    },
    {
      id: 'modal-title',
      component: {
        Text: {text: {literalString: 'Details'}, usageHint: 'h2'},
      },
    },
    {
      id: 'modal-body',
      component: {
        Text: {
          text: {
            literalString:
              'Here are the details you requested. This modal contains a card with multiple text elements.',
          },
        },
      },
    },
    {
      id: 'modal-content-col',
      component: {
        Column: {children: {explicitList: ['modal-title', 'modal-body']}},
      },
    },
    {
      id: 'modal-card',
      component: {
        Card: {child: 'modal-content-col'},
      },
    },
    {
      id: 'modal-2',
      component: {
        Modal: {
          entryPointChild: 'trigger-btn-2',
          contentChild: 'modal-card',
        },
      },
    },
  ],
};

export const modalFixtures = {
  modalBasic,
  modalWithCard,
};
