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

import catalogJson from './catalog.json' with {type: 'json'};
import {IFRAME_CATALOG_ID} from './catalog.js';

describe('IFRAME_CATALOG_ID', () => {
  it('is the $id of the bundled catalog schema', () => {
    expect(IFRAME_CATALOG_ID).toBe(catalogJson['$id']);
  });

  it('names the catalog of the two frame components', () => {
    expect(Object.keys(catalogJson['components'])).toEqual(['WebAppFrameUrl', 'WebAppFrameSrcdoc']);
  });
});
