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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  AllowlistUrlSecurityPolicy,
  PermissiveUrlSecurityPolicy,
  type UrlCheckInfo,
  type UrlContext,
  type UrlSecurityPolicy,
} from '../index.js';
import {applyUrlSecurityPolicy, checkUrlBaseline} from './url_security_policy.js';

describe('URL baseline', () => {
  const allowed: Array<[string, UrlContext]> = [
    ['https://example.com/a.png', 'media'],
    ['http://example.com/a.png', 'media'],
    ['HTTPS://EXAMPLE.COM/a.png', 'media'],
    ['https://user@example.com:8443/a?b#c', 'navigation'],
    ['https://[::1]/a', 'iframe'],
    ['/assets/logo.png', 'media'],
    ['assets/logo.png', 'media'],
    ['../logo.png', 'navigation'],
    ['?q=1', 'navigation'],
    ['data:image/png;base64,AAAA', 'media'],
    ['DATA:Video/MP4;base64,AAAA', 'media'],
    ['data:audio/mpeg,abc', 'media'],
    ['mailto:someone@example.com', 'navigation'],
    ['tel:+15551234567', 'navigation'],
  ];
  for (const [url, context] of allowed) {
    it(`allows ${JSON.stringify(url)} as ${context}, unchanged`, () => {
      assert.strictEqual(checkUrlBaseline(url, context), url);
    });
  }

  const blocked: Array<[unknown, UrlContext]> = [
    [undefined, 'media'],
    [123, 'media'],
    ['', 'media'],
    [' https://example.com/a.png', 'media'],
    ['https://example.com/a b.png', 'media'],
    ['https://example.com/a.png\n', 'media'],
    ['/\t/evil.example/a.png', 'media'],
    ['https\t:evil.example/a.png', 'media'],
    ['/\\evil.example/a.png', 'media'],
    ['https://evil.example\\@good.example/', 'navigation'],
    ['\u0000https://example.com', 'media'],
    ['https://example.com/\u007f', 'media'],
    ['//evil.example/a.png', 'media'],
    ['https:evil.example/a.png', 'media'],
    ['http:evil.example/a.png', 'navigation'],
    ['https:///evil.example/a.png', 'media'],
    ['https://', 'media'],
    ['javascript:alert(1)', 'navigation'],
    ['JaVaScRiPt:alert(1)', 'navigation'],
    ['vbscript:msgbox(1)', 'navigation'],
    ['file:///etc/passwd', 'media'],
    ['blob:https://example.com/123', 'media'],
    ['data:image/svg+xml;base64,PHN2Zz4=', 'media'],
    ['DATA:IMAGE/SVG+XML,<svg/>', 'media'],
    ['data:text/html,<script>alert(1)</script>', 'media'],
    ['data:,x', 'media'],
    ['data:image/png;base64,AAAA', 'navigation'],
    ['mailto:someone@example.com', 'media'],
    ['tel:+15551234567', 'iframe'],
    ['/relative/page.html', 'iframe'],
  ];
  for (const [url, context] of blocked) {
    it(`blocks ${JSON.stringify(url)} as ${context}`, () => {
      assert.strictEqual(checkUrlBaseline(url, context), undefined);
    });
  }

  it('allows SVG data URLs as media only when opted in', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
    assert.strictEqual(checkUrlBaseline(svg, 'media', true), svg);
    assert.strictEqual(checkUrlBaseline(svg, 'navigation', true), undefined);
  });
});

describe('PermissiveUrlSecurityPolicy', () => {
  it('allows what the baseline allows and nothing else', () => {
    const policy = new PermissiveUrlSecurityPolicy();
    assert.strictEqual(
      policy.sanitizeUrl('https://anywhere.example/a.png', 'media'),
      'https://anywhere.example/a.png',
    );
    assert.strictEqual(policy.sanitizeUrl('javascript:alert(1)', 'navigation'), undefined);
    assert.strictEqual(policy.sanitizeUrl('data:image/svg+xml,<svg/>', 'media'), undefined);
  });

  it('opts into SVG data URLs', () => {
    const policy = new PermissiveUrlSecurityPolicy({allowSvgDataUrls: true});
    assert.strictEqual(
      policy.sanitizeUrl('data:image/svg+xml,<svg/>', 'media'),
      'data:image/svg+xml,<svg/>',
    );
  });
});

describe('AllowlistUrlSecurityPolicy', () => {
  const policy = new AllowlistUrlSecurityPolicy({
    media: ['cdn.example.com', '*.images.example.com', 'localhost:8080'],
    navigation: ['*.example.com'],
    iframe: ['apps.example.com'],
  });

  it('matches exact hosts case-insensitively', () => {
    assert.ok(policy.sanitizeUrl('https://cdn.example.com/a.png', 'media'));
    assert.ok(policy.sanitizeUrl('https://CDN.Example.COM/a.png', 'media'));
    assert.ok(policy.sanitizeUrl('http://cdn.example.com:9999/a.png', 'media'));
    assert.strictEqual(
      policy.sanitizeUrl('https://cdn.example.com.evil/a.png', 'media'),
      undefined,
    );
    assert.strictEqual(policy.sanitizeUrl('https://evilcdn.example.com/a.png', 'media'), undefined);
  });

  it('matches wildcards against subdomains at any depth, but not the apex', () => {
    assert.ok(policy.sanitizeUrl('https://a.images.example.com/x.png', 'media'));
    assert.ok(policy.sanitizeUrl('https://a.b.images.example.com/x.png', 'media'));
    assert.strictEqual(policy.sanitizeUrl('https://images.example.com/x.png', 'media'), undefined);
    assert.strictEqual(
      policy.sanitizeUrl('https://evilimages.example.com/x.png', 'media'),
      undefined,
    );
  });

  it('compares entries with a port against host and port', () => {
    assert.ok(policy.sanitizeUrl('http://localhost:8080/a.png', 'media'));
    assert.strictEqual(policy.sanitizeUrl('http://localhost:8081/a.png', 'media'), undefined);
    assert.strictEqual(policy.sanitizeUrl('http://localhost/a.png', 'media'), undefined);
  });

  it("keeps an entry's port when it is the default port of https", () => {
    const secure = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com:443', '[::1]:443']});
    assert.ok(secure.sanitizeUrl('https://cdn.example.com/a.png', 'media'));
    assert.ok(secure.sanitizeUrl('https://cdn.example.com:443/a.png', 'media'));
    assert.ok(secure.sanitizeUrl('https://[::1]/a.png', 'media'));
    assert.strictEqual(secure.sanitizeUrl('http://cdn.example.com/a.png', 'media'), undefined);
    assert.strictEqual(
      secure.sanitizeUrl('https://cdn.example.com:8443/a.png', 'media'),
      undefined,
    );
    assert.strictEqual(secure.sanitizeUrl('http://[::1]/a.png', 'media'), undefined);
  });

  it('ignores userinfo that looks like an allowed host', () => {
    assert.strictEqual(
      policy.sanitizeUrl('https://cdn.example.com@evil.example/a.png', 'media'),
      undefined,
    );
  });

  it('keeps each context to its own list', () => {
    assert.strictEqual(policy.sanitizeUrl('https://cdn.example.com/', 'iframe'), undefined);
    assert.ok(policy.sanitizeUrl('https://apps.example.com/', 'iframe'));
    assert.ok(policy.sanitizeUrl('https://shop.example.com/p/1', 'navigation'));
  });

  it('leaves contexts without a list at the baseline', () => {
    const mediaOnly = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
    assert.ok(mediaOnly.sanitizeUrl('https://anywhere.example/', 'navigation'));
    assert.ok(mediaOnly.sanitizeUrl('/page', 'navigation'));
  });

  it('blocks every http(s) URL of a context with an empty list', () => {
    const none = new AllowlistUrlSecurityPolicy({media: []});
    assert.strictEqual(none.sanitizeUrl('https://cdn.example.com/a.png', 'media'), undefined);
  });

  it('blocks relative URLs once a context has a list, unless opted in', () => {
    assert.strictEqual(policy.sanitizeUrl('/logo.png', 'media'), undefined);
    const relativeOk = new AllowlistUrlSecurityPolicy({
      media: ['cdn.example.com'],
      allowRelative: ['media'],
    });
    assert.strictEqual(relativeOk.sanitizeUrl('/logo.png', 'media'), '/logo.png');
  });

  it('does not apply host lists to URLs without a host', () => {
    assert.ok(policy.sanitizeUrl('data:image/png;base64,AAAA', 'media'));
    assert.ok(policy.sanitizeUrl('mailto:a@example.org', 'navigation'));
    assert.ok(policy.sanitizeUrl('tel:+1555', 'navigation'));
  });

  it('still applies the baseline', () => {
    assert.strictEqual(policy.sanitizeUrl('javascript:alert(1)', 'navigation'), undefined);
    assert.strictEqual(policy.sanitizeUrl('https:cdn.example.com/a.png', 'media'), undefined);
  });

  it('normalizes host entries the way the URL parser normalizes hosts', () => {
    const idn = new AllowlistUrlSecurityPolicy({media: ['BÜCHER.example.', '*.Example.ORG']});
    assert.ok(idn.sanitizeUrl('https://xn--bcher-kva.example/a.png', 'media'));
    assert.ok(idn.sanitizeUrl('https://bücher.example./a.png', 'media'));
    assert.ok(idn.sanitizeUrl('https://a.example.org/a.png', 'media'));
  });

  it('rejects malformed host entries', () => {
    for (const entry of [
      'https://cdn.example.com',
      '*',
      '*.',
      'a.*.com',
      'cdn.example.com/x',
      '',
    ]) {
      assert.throws(() => new AllowlistUrlSecurityPolicy({media: [entry]}), TypeError, entry);
    }
  });

  it('rewrites allowed URLs with the context hook', () => {
    const seen: Array<[string, UrlContext, UrlCheckInfo | undefined]> = [];
    const proxy = new AllowlistUrlSecurityPolicy({
      media: ['cdn.other.com'],
      rewrite: {
        media: (url, context, info) => {
          seen.push([url, context, info]);
          return `https://proxy.example.com/?u=${encodeURIComponent(url)}`;
        },
      },
    });
    assert.strictEqual(
      proxy.sanitizeUrl('https://cdn.other.com/a.png', 'media', {componentType: 'Image'}),
      'https://proxy.example.com/?u=https%3A%2F%2Fcdn.other.com%2Fa.png',
    );
    assert.deepStrictEqual(seen, [
      ['https://cdn.other.com/a.png', 'media', {componentType: 'Image'}],
    ]);
    // A URL the list blocks never reaches the hook.
    assert.strictEqual(proxy.sanitizeUrl('https://evil.example/a.png', 'media'), undefined);
    assert.strictEqual(seen.length, 1);
  });
});

describe('applyUrlSecurityPolicy', () => {
  it('runs the baseline before a custom policy sees the URL', () => {
    const seen: string[] = [];
    const policy: UrlSecurityPolicy = {
      sanitizeUrl: url => {
        seen.push(url);
        return url;
      },
    };
    assert.strictEqual(
      applyUrlSecurityPolicy(policy, 'javascript:alert(1)', 'navigation'),
      undefined,
    );
    assert.deepStrictEqual(seen, []);
  });

  it('runs the baseline again on what a policy returns', () => {
    const rewriteToScript: UrlSecurityPolicy = {sanitizeUrl: () => 'javascript:alert(1)'};
    assert.strictEqual(
      applyUrlSecurityPolicy(rewriteToScript, 'https://example.com/', 'navigation'),
      undefined,
    );
    const rewriteToProxy: UrlSecurityPolicy = {sanitizeUrl: () => 'https://proxy.example.com/x'};
    assert.strictEqual(
      applyUrlSecurityPolicy(rewriteToProxy, 'https://example.com/', 'media'),
      'https://proxy.example.com/x',
    );
  });

  it('blocks the URL when a policy throws or returns a non-string', () => {
    const throwing: UrlSecurityPolicy = {
      sanitizeUrl: () => {
        throw new Error('boom');
      },
    };
    assert.strictEqual(
      applyUrlSecurityPolicy(throwing, 'https://example.com/', 'media'),
      undefined,
    );
    const nonString = {sanitizeUrl: () => 42} as unknown as UrlSecurityPolicy;
    assert.strictEqual(
      applyUrlSecurityPolicy(nonString, 'https://example.com/', 'media'),
      undefined,
    );
  });

  it("honors a custom policy's SVG opt-in in the baseline", () => {
    const svg = 'data:image/svg+xml,<svg/>';
    const optIn: UrlSecurityPolicy = {sanitizeUrl: url => url, allowSvgDataUrls: true};
    assert.strictEqual(applyUrlSecurityPolicy(optIn, svg, 'media'), svg);
    const noOptIn: UrlSecurityPolicy = {sanitizeUrl: url => url};
    assert.strictEqual(applyUrlSecurityPolicy(noOptIn, svg, 'media'), undefined);
  });
});
