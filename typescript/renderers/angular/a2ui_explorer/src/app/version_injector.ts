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
      // Accept both `?version=v1.0` and the bare `?version=1.0`.
      const version = urlParams.get('version')?.replace(/^(\d)/, 'v$1');
      if (version === Version.V0_8 || version === Version.V0_9 || version === Version.V1_0) {
        return version;
      }
    }
    return Version.V0_9;
  },
});
