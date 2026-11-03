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

export const BOUNDARY_RESTRICTED = {
  names: ['ComponentContext', 'GenericBinder', 'DataContext'],
  from: [
    '@a2ui/web_core',
    '@a2ui/web_core/v0_9',
    '@a2ui/web_core/v1_0',
    '@a2ui/web_core/resolution',
    '@a2ui/web_core/rendering',
  ],
};

export const BOUNDARY_ALLOWLIST = [
  'src/catalog/angular_wc_host.ts',
  'src/core/component-binder.service.ts',
  'src/core/component-host.component.ts',
  'src/v0_9/catalog/basic/button.component.ts',
];
