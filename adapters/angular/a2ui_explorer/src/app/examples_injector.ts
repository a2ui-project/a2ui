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

import {InjectionToken, inject} from '@angular/core';
import {EXAMPLES_V08, EXAMPLES_V09} from './generated/examples-bundle';
import {Version, A2uiExample} from './types';
import {A2UI_VERSION} from './version_injector';

/**
 * Dependency injection token for the active A2UI examples list.
 */
export const A2UI_EXAMPLES = new InjectionToken<Array<A2uiExample>>('A2UI_EXAMPLES', {
  providedIn: 'root',
  factory: () => {
    const version = inject(A2UI_VERSION);
    return version === Version.V0_9 ? EXAMPLES_V09 : EXAMPLES_V08;
  },
});
