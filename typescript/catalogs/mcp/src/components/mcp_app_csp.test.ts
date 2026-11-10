/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AllowlistUrlSecurityPolicy,
  PermissiveUrlSecurityPolicy,
  type UrlContext,
  type UrlSecurityPolicy,
} from '@a2ui/web_core';
import {capCspByUrlPolicy, cspSourceToUrls, isCspSourceAllowed} from './mcp_app_csp.js';

/** The check `ComponentContext.sanitizeUrl` runs, reduced to the policy itself. */
function checkWith(policy: UrlSecurityPolicy) {
  return (url: string, context: UrlContext) => policy.sanitizeUrl(url, context);
}

describe('cspSourceToUrls', () => {
  it('maps host sources to the URL the policy checks', () => {
    expect(cspSourceToUrls('https://cdn.example.com')).toEqual(['https://cdn.example.com/']);
    expect(cspSourceToUrls('cdn.example.com')).toEqual(['https://cdn.example.com/']);
    expect(cspSourceToUrls('http://localhost:8080')).toEqual(['http://localhost:8080/']);
    expect(cspSourceToUrls('https://cdn.example.com/assets/')).toEqual([
      'https://cdn.example.com/assets/',
    ]);
    expect(cspSourceToUrls('https://[::1]:3000')).toEqual(['https://[::1]:3000/']);
  });

  it('checks WebSocket sources as the HTTP URL of their handshake', () => {
    expect(cspSourceToUrls('wss://live.example.com')).toEqual(['https://live.example.com/']);
    expect(cspSourceToUrls('ws://live.example.com')).toEqual(['http://live.example.com/']);
  });

  it('keeps host wildcards in the host', () => {
    expect(cspSourceToUrls('https://*.example.com')).toEqual(['https://*.example.com/']);
    expect(cspSourceToUrls('*.example.com')).toEqual(['https://*.example.com/']);
    expect(cspSourceToUrls('*')).toEqual(['https://*/']);
    expect(cspSourceToUrls('https:')).toEqual(['https://*/']);
    expect(cspSourceToUrls('wss:')).toEqual(['https://*/']);
  });

  it('checks a port wildcard with the default port and another port', () => {
    expect(cspSourceToUrls('https://api.example.com:*')).toEqual([
      'https://api.example.com/',
      'https://api.example.com:1/',
    ]);
  });

  it('returns undefined for sources it cannot map', () => {
    for (const source of [
      "'self'",
      "'none'",
      'ftp://files.example.com',
      'javascript:',
      'https://user@example.com',
      'https://a.*.example.com',
      'https://example.com:abc',
      '',
    ]) {
      expect(cspSourceToUrls(source)).withContext(source).toBeUndefined();
    }
  });
});

describe('isCspSourceAllowed', () => {
  const allowlist = checkWith(
    new AllowlistUrlSecurityPolicy({
      media: ['cdn.example.com', '*.assets.example.com', 'localhost:8080'],
    }),
  );

  it('allows sources whose host is on the allowlist', () => {
    expect(isCspSourceAllowed('https://cdn.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('cdn.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('wss://cdn.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('https://a.assets.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('http://localhost:8080', 'media', allowlist)).toBeTrue();
  });

  it('blocks sources whose host is not on the allowlist', () => {
    expect(isCspSourceAllowed('https://evil.example', 'media', allowlist)).toBeFalse();
    expect(isCspSourceAllowed('https://assets.example.com', 'media', allowlist)).toBeFalse();
    expect(isCspSourceAllowed('http://localhost:9090', 'media', allowlist)).toBeFalse();
  });

  it('leaves contexts without a host list at the baseline', () => {
    expect(isCspSourceAllowed('https://anywhere.example', 'iframe', allowlist)).toBeTrue();
  });

  it('allows a wildcard source only when an allowlist wildcard covers it', () => {
    expect(isCspSourceAllowed('https://*.assets.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('*.x.assets.example.com', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('https://*.example.com', 'media', allowlist)).toBeFalse();
    expect(isCspSourceAllowed('https://*.cdn.example.com', 'media', allowlist)).toBeFalse();
    expect(isCspSourceAllowed('*', 'media', allowlist)).toBeFalse();
    expect(isCspSourceAllowed('https:', 'media', allowlist)).toBeFalse();
  });

  it('allows a port wildcard only when the policy allows any port', () => {
    expect(isCspSourceAllowed('https://cdn.example.com:*', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('http://localhost:*', 'media', allowlist)).toBeFalse();
  });

  it('keeps data: and blob: sources, which load nothing from a server', () => {
    expect(isCspSourceAllowed('data:', 'media', allowlist)).toBeTrue();
    expect(isCspSourceAllowed('blob:', 'media', allowlist)).toBeTrue();
  });

  it('drops sources it cannot map, whatever the policy', () => {
    const permissive = checkWith(new PermissiveUrlSecurityPolicy());
    expect(isCspSourceAllowed("'self'", 'media', permissive)).toBeFalse();
    expect(isCspSourceAllowed('ftp://files.example.com', 'media', permissive)).toBeFalse();
  });

  it('blocks a source the policy rewrites to another host', () => {
    const proxy = checkWith(
      new AllowlistUrlSecurityPolicy({
        media: ['cdn.example.com'],
        rewrite: {media: url => `https://proxy.example.com/?u=${encodeURIComponent(url)}`},
      }),
    );
    expect(isCspSourceAllowed('https://cdn.example.com', 'media', proxy)).toBeFalse();
  });

  it('allows a source the policy rewrites within the same host', () => {
    const tagged = checkWith(
      new AllowlistUrlSecurityPolicy({
        media: ['cdn.example.com'],
        rewrite: {media: url => `${url}?via=host`},
      }),
    );
    expect(isCspSourceAllowed('https://cdn.example.com', 'media', tagged)).toBeTrue();
  });
});

describe('capCspByUrlPolicy', () => {
  it('checks each list in its own URL context', () => {
    const contexts: Array<[string, UrlContext]> = [];
    capCspByUrlPolicy(
      {
        connectDomains: ['https://connect.example.com'],
        resourceDomains: ['https://resource.example.com'],
        frameDomains: ['https://frame.example.com'],
        baseUriDomains: ['https://base.example.com'],
      },
      (url, context) => {
        contexts.push([url, context]);
        return url;
      },
    );
    expect(contexts).toEqual([
      ['https://connect.example.com/', 'media'],
      ['https://resource.example.com/', 'media'],
      ['https://frame.example.com/', 'iframe'],
      ['https://base.example.com/', 'navigation'],
    ]);
  });

  it('removes disallowed sources and leaves unset lists unset', () => {
    const capped = capCspByUrlPolicy(
      {
        connectDomains: ['https://api.example.com', 'https://evil.example'],
        frameDomains: ['https://evil.example'],
      },
      checkWith(new AllowlistUrlSecurityPolicy({media: ['api.example.com'], iframe: []})),
    );
    expect(capped).toEqual({connectDomains: ['https://api.example.com'], frameDomains: []});
  });

  it('keeps every mappable source under the permissive policy', () => {
    const csp = {
      connectDomains: ['https://api.example.com', 'wss://*.example.com', 'http://localhost:*'],
      resourceDomains: ['cdn.example.com', '*', 'https:', 'data:', 'blob:'],
      frameDomains: ['https://embed.example.com'],
      baseUriDomains: ['https://docs.example.com/base/'],
    };
    expect(capCspByUrlPolicy(csp, checkWith(new PermissiveUrlSecurityPolicy()))).toEqual(csp);
  });

  it('drops entries that are not strings', () => {
    const capped = capCspByUrlPolicy(
      {connectDomains: ['https://api.example.com', 42 as unknown as string]},
      url => url,
    );
    expect(capped).toEqual({connectDomains: ['https://api.example.com']});
  });
});
