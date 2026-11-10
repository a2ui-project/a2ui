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

import type {UrlContext} from '@a2ui/web_core';

import {
  BLOCKED_CHART_URL_MESSAGE,
  createUrlPolicyLoader,
  type VegaBaseLoader,
  type VegaSanitizeOptions,
} from './url_policy_loader.js';

/** A base loader that records its calls and echoes the URL it gets. */
function recordingBase() {
  const calls: Array<{method: string; url: string; options?: VegaSanitizeOptions}> = [];
  const base: VegaBaseLoader = {
    async sanitize(url, options) {
      calls.push({method: 'sanitize', url, options});
      const result = {href: url};
      Object.defineProperty(result, 'localFile', {value: url.startsWith('file:')});
      return result;
    },
    async http(url, options) {
      calls.push({method: 'http', url, options});
      return `http:${url}`;
    },
    async file(path) {
      calls.push({method: 'file', url: path});
      return `file:${path}`;
    },
  };
  return {base, calls};
}

/** A policy check that allows `cdn.example.com` and `docs.example.com` links, and records calls. */
function recordingPolicy(rewrite?: (url: string) => string) {
  const checks: Array<{url: string; context: UrlContext}> = [];
  const sanitize = (url: string, context: UrlContext) => {
    checks.push({url, context});
    const allowedHost = context === 'navigation' ? 'docs.example.com' : 'cdn.example.com';
    if (!url.startsWith(`https://${allowedHost}/`)) return undefined;
    return rewrite ? rewrite(url) : url;
  };
  return {sanitize, checks};
}

describe('createUrlPolicyLoader', () => {
  it('checks data, image, and unlabeled URLs as media and href URLs as navigation', async () => {
    const {base} = recordingBase();
    const {sanitize, checks} = recordingPolicy();
    const loader = createUrlPolicyLoader(base, sanitize);

    await loader.sanitize('https://cdn.example.com/data.csv', {context: 'dataflow'});
    await loader.sanitize('https://cdn.example.com/logo.png', {context: 'image'});
    await loader.sanitize('https://cdn.example.com/plain.json');
    await loader.sanitize('https://docs.example.com/page', {context: 'href'});

    assert.deepStrictEqual(
      checks.map(c => c.context),
      ['media', 'media', 'media', 'navigation'],
    );
  });

  it('passes an allowed URL to the base loader with the original options', async () => {
    const {base, calls} = recordingBase();
    const loader = createUrlPolicyLoader(base, recordingPolicy().sanitize);

    const result = await loader.sanitize('https://cdn.example.com/logo.png', {context: 'image'});

    assert.strictEqual(result.href, 'https://cdn.example.com/logo.png');
    assert.deepStrictEqual(calls, [
      {method: 'sanitize', url: 'https://cdn.example.com/logo.png', options: {context: 'image'}},
    ]);
  });

  it('rejects a blocked URL without calling the base loader or naming the URL', async () => {
    const {base, calls} = recordingBase();
    const loader = createUrlPolicyLoader(base, recordingPolicy().sanitize);

    await assert.rejects(
      loader.sanitize('https://evil.example/track.png?secret=1', {context: 'image'}),
      (error: Error) => {
        assert.strictEqual(error.message, BLOCKED_CHART_URL_MESSAGE);
        assert.ok(!error.message.includes('evil.example'));
        return true;
      },
    );
    await assert.rejects(loader.sanitize('https://cdn.example.com/a', {context: 'href'}));
    await assert.rejects(loader.load('https://evil.example/data.csv'));
    assert.deepStrictEqual(calls, []);
  });

  it('uses the rewritten URL for the request', async () => {
    const {base, calls} = recordingBase();
    const proxy = (url: string) => `https://proxy.example.com/?u=${encodeURIComponent(url)}`;
    const loader = createUrlPolicyLoader(base, recordingPolicy(proxy).sanitize);

    const text = await loader.load('https://cdn.example.com/data.csv', {context: 'dataflow'});

    const proxied = proxy('https://cdn.example.com/data.csv');
    assert.strictEqual(text, `http:${proxied}`);
    assert.deepStrictEqual(
      calls.map(c => [c.method, c.url]),
      [
        ['sanitize', proxied],
        ['http', proxied],
      ],
    );
  });

  it('checks the URL the base loader resolves against its baseURL', async () => {
    const {base} = recordingBase();
    const resolving: VegaBaseLoader = {
      ...base,
      async sanitize(url, options) {
        return base.sanitize(/^[a-z]+:/.test(url) ? url : `https://evil.example/${url}`, options);
      },
    };
    const checks: string[] = [];
    const loader = createUrlPolicyLoader(resolving, url => {
      checks.push(url);
      return url.startsWith('https://evil.example/') ? undefined : url;
    });

    await assert.rejects(loader.load('data.csv'), new RegExp(BLOCKED_CHART_URL_MESSAGE));
    assert.deepStrictEqual(checks, ['data.csv', 'https://evil.example/data.csv']);
    const absolute = await loader.sanitize('https://cdn.example.com/a.csv');
    assert.strictEqual(absolute.href, 'https://cdn.example.com/a.csv');
    assert.strictEqual(checks.length, 3, 'an unchanged URL is checked once');
  });

  it('loads local files through the base file loader', async () => {
    const {base, calls} = recordingBase();
    const loader = createUrlPolicyLoader(base, url => url);

    assert.strictEqual(await loader.load('file:///data.csv'), 'file:file:///data.csv');
    assert.deepStrictEqual(
      calls.map(c => c.method),
      ['sanitize', 'file'],
    );
  });

  it('checks the URL before a pending base loader resolves', async () => {
    const {base} = recordingBase();
    let resolveBase!: (loader: VegaBaseLoader) => void;
    const pending = new Promise<VegaBaseLoader>(resolve => (resolveBase = resolve));
    const {sanitize, checks} = recordingPolicy();
    const loader = createUrlPolicyLoader(pending, sanitize);

    const result = loader.sanitize('https://cdn.example.com/a.png', {context: 'image'});
    assert.strictEqual(checks.length, 1, 'the policy runs before the base loader is ready');
    resolveBase(base);

    assert.strictEqual((await result).href, 'https://cdn.example.com/a.png');
  });

  it('rejects calls when the base loader fails to load', async () => {
    const loader = createUrlPolicyLoader(Promise.reject(new Error('no vega')), url => url);
    await assert.rejects(loader.sanitize('https://cdn.example.com/a.png'), /no vega/);
  });
});
