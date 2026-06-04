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

import {InjectionToken} from '@angular/core';
import {Version} from './types';

/**
 * Dependency injection token for the active A2UI protocol version.
 */
export const A2UI_VERSION = new InjectionToken<Version>('A2UI_VERSION', {
  providedIn: 'root',
  factory: () => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const version = urlParams.get('version');
      if (version === Version.V0_8 || version === Version.V0_9) {
        return version as Version;
      }
    }
    return Version.V0_9;
  },
});
