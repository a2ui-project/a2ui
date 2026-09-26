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

import {
  configureSandbox,
  DEFAULT_SANDBOX_BASE_URL,
  getSandboxConfig,
  resetSandboxConfig,
  resolveSandboxUrl,
} from './sandbox_config.js';

describe('sandbox configuration', () => {
  const HOST = {
    documentBase: 'https://app.example/chat/index.html',
    hostOrigin: 'https://app.example',
  };

  afterEach(() => {
    resetSandboxConfig();
  });

  it('defaults to /a2ui-sandbox/ on the host origin', () => {
    expect(getSandboxConfig()).toEqual({baseUrl: DEFAULT_SANDBOX_BASE_URL});
  });

  it('resolves the html and url pages under the default directory with the self-test disabled', () => {
    expect(resolveSandboxUrl('html', HOST).href).toBe(
      'https://app.example/a2ui-sandbox/sandbox.html?disable_security_self_test=true',
    );
    expect(resolveSandboxUrl('url', HOST).href).toBe(
      'https://app.example/a2ui-sandbox/sandbox-url.html?disable_security_self_test=true',
    );
  });

  it('resolves a relative base URL against the document base', () => {
    configureSandbox({baseUrl: 'static/sandbox'});
    expect(resolveSandboxUrl('html', HOST).href).toBe(
      'https://app.example/chat/static/sandbox/sandbox.html?disable_security_self_test=true',
    );
  });

  it('keeps the self-test enabled when the proxy is served from another origin', () => {
    configureSandbox({baseUrl: 'https://sandbox.example/a2ui/'});
    const url = resolveSandboxUrl('html', HOST);
    expect(url.href).toBe('https://sandbox.example/a2ui/sandbox.html');
    expect(url.origin).toBe('https://sandbox.example');
  });

  it('honours an explicit self-test setting in both directions', () => {
    configureSandbox({disableSecuritySelfTest: false});
    expect(resolveSandboxUrl('html', HOST).href).toBe(
      'https://app.example/a2ui-sandbox/sandbox.html',
    );

    configureSandbox({baseUrl: 'https://sandbox.example/', disableSecuritySelfTest: true});
    expect(resolveSandboxUrl('url', HOST).href).toBe(
      'https://sandbox.example/sandbox-url.html?disable_security_self_test=true',
    );
  });

  it('merges partial configuration and resets to the defaults', () => {
    configureSandbox({disableSecuritySelfTest: true});
    configureSandbox({baseUrl: '/frames/'});
    expect(getSandboxConfig()).toEqual({baseUrl: '/frames/', disableSecuritySelfTest: true});

    configureSandbox({disableSecuritySelfTest: undefined});
    expect(getSandboxConfig().disableSecuritySelfTest).toBeUndefined();

    resetSandboxConfig();
    expect(getSandboxConfig()).toEqual({baseUrl: DEFAULT_SANDBOX_BASE_URL});
  });

  it('uses the current document and origin when no options are given', () => {
    const url = resolveSandboxUrl('html');
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a2ui-sandbox/sandbox.html');
    expect(url.searchParams.get('disable_security_self_test')).toBe('true');
  });
});
