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

import type {AgentToRendererMessage} from '@a2ui/agent';

/**
 * A worked example of the UI this agent is expected to produce, handed to `A2uiGenerator`
 * and embedded verbatim in the model prompt.
 *
 * The `AgentToRendererMessage` annotation is load-bearing, not decoration. Every v1.0
 * message schema is `.strict()`, so an unrecognized key -- a `root` or a `theme` that the
 * protocol has no notion of -- is a compile error here rather than a runtime validation
 * failure at stream time. An untyped example teaches the model invalid syntax.
 */
export const confirmationExample: AgentToRendererMessage[] = [
  {
    version: 'v1.0',
    createSurface: {
      surfaceId: 'confirmation',
      catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    },
  },
  {
    version: 'v1.0',
    updateComponents: {
      surfaceId: 'confirmation',
      components: [
        {
          id: 'root',
          component: 'Card',
          child: 'confirmation-column',
        },
        {
          id: 'confirmation-column',
          component: 'Column',
          children: ['confirm-title', 'confirm-text'],
        },
        {
          id: 'confirm-title',
          component: 'Text',
          variant: 'h2',
          text: {
            path: '/title',
          },
        },
        {
          id: 'confirm-text',
          component: 'Text',
          text: 'We look forward to seeing you!',
        },
      ],
    },
  },
  {
    version: 'v1.0',
    updateDataModel: {
      surfaceId: 'confirmation',
      path: '/',
      value: {
        title: 'Booking at [RestaurantName]',
      },
    },
  },
];
