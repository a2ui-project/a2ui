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
import {
  A2uiMessageType,
  configureSandbox,
  IFRAME_CATALOG_ID,
  resetSandboxConfig,
  resolveSandboxUrl,
  WebAppFrameBridge,
} from './index.js';

describe('@a2ui/catalog-iframe entry point', () => {
  afterEach(() => {
    resetSandboxConfig();
  });

  it('exposes the $id of the bundled catalog schema', () => {
    expect(IFRAME_CATALOG_ID).toBe(catalogJson['$id']);
    expect(Object.keys(catalogJson['components'])).toEqual(['WebAppFrameUrl', 'WebAppFrameSrcdoc']);
  });

  it('exposes the sandbox configuration and the bridge', () => {
    configureSandbox({baseUrl: '/frames/'});
    expect(
      resolveSandboxUrl('html', {
        documentBase: 'https://app.example/',
        hostOrigin: 'https://app.example',
      }).pathname,
    ).toBe('/frames/sandbox.html');
    expect(typeof WebAppFrameBridge).toBe('function');
    expect(A2uiMessageType.AppFrameInit).toBe('a2ui_app_frame_init');
  });
});
