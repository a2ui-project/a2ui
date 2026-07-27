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
 * AudioPlayer component fixtures for visual parity testing.
 *
 * Note: The `description` property is defined in the A2UI spec but is NOT
 * implemented in the Lit renderer. Only the `url` property is used by Lit.
 * React implements description, but these fixtures only test url for parity.
 */

import type {ComponentFixture} from '../types';

export const audioPlayerBasic: ComponentFixture = {
  root: 'audio-1',
  components: [
    {
      id: 'audio-1',
      component: {
        AudioPlayer: {
          url: {literalString: 'https://www.w3schools.com/html/horse.mp3'},
        },
      },
    },
  ],
};

export const audioPlayerWithPathBinding: ComponentFixture = {
  root: 'audio-2',
  data: {
    '/media/audioUrl': 'https://www.w3schools.com/html/horse.mp3',
  },
  components: [
    {
      id: 'audio-2',
      component: {
        AudioPlayer: {
          url: {path: '/media/audioUrl'},
        },
      },
    },
  ],
};

export const audioPlayerFixtures = {
  audioPlayerBasic,
  audioPlayerWithPathBinding,
};
