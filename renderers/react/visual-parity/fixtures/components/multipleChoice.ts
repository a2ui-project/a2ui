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
 * MultipleChoice component fixtures for visual parity testing.
 *
 * Both Lit and React render a <select> dropdown with a description label.
 * A single fixture is sufficient since maxAllowedSelections does not
 * affect the visual rendering (always a dropdown).
 */

import type {ComponentFixture} from '../types';

export const multipleChoice: ComponentFixture = {
  root: 'mc-1',
  components: [
    {
      id: 'mc-1',
      component: {
        MultipleChoice: {
          selections: {path: '/mcSelections'},
          options: [
            {value: 'option1', label: {literalString: 'Option 1'}},
            {value: 'option2', label: {literalString: 'Option 2'}},
            {value: 'option3', label: {literalString: 'Option 3'}},
          ],
        },
      },
    },
  ],
};

export const multipleChoiceFixtures = {
  multipleChoice,
};
