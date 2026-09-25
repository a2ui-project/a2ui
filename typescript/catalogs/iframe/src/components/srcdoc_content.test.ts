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
  decodeHtmlContent,
  injectContentSecurityPolicy,
  prepareSrcdocContent,
  SRCDOC_CONTENT_SECURITY_POLICY,
} from './srcdoc_content.js';

/** Parses the secured markup the way the inner frame will, to check where things ended up. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function cspContents(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).map(
    meta => meta.getAttribute('content') ?? '',
  );
}

describe('injectContentSecurityPolicy', () => {
  it('adds the strict policy and the link interceptor to an existing head', () => {
    const secured = injectContentSecurityPolicy(
      '<html><head><title>App</title></head><body>Content</body></html>',
    );

    expect(secured).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/);
    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    expect(doc.head.querySelector('script')?.textContent).toContain("closest('a')");
    expect(doc.title).toBe('App');
    expect(doc.body.textContent).toBe('Content');
  });

  it('confines the document: no network, forms, base URL, plugins or nested frames', () => {
    for (const directive of [
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:",
    ]) {
      expect(SRCDOC_CONTENT_SECURITY_POLICY).toContain(directive);
    }
  });

  it('creates a head inside html when the markup has none', () => {
    const secured = injectContentSecurityPolicy('<html><body><h1>No Head</h1></body></html>');

    expect(secured).toMatch(/<html>\s*<head>\s*<meta http-equiv="Content-Security-Policy"/);
    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    expect(doc.body.querySelector('h1')?.textContent).toBe('No Head');
  });

  it('prefixes a bare fragment with a head', () => {
    const secured = injectContentSecurityPolicy('<button id="btn">Click me</button>');

    expect(secured).toMatch(/^<head>\s*<meta http-equiv="Content-Security-Policy"/);
    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    expect(doc.querySelector('#btn')?.textContent).toBe('Click me');
  });

  it('removes author CSP meta tags so they cannot override the policy', () => {
    const secured = injectContentSecurityPolicy(
      '<html><head><meta http-equiv="Content-Security-Policy" content="connect-src *;">' +
        '<META HTTP-EQUIV=\'content-security-policy\' CONTENT="default-src *">' +
        '<meta charset="utf-8"><title>Test</title></head><body></body></html>',
    );

    expect(secured).not.toContain('connect-src *');
    expect(secured).not.toContain('default-src *');
    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    expect(doc.querySelector('meta[charset]')).not.toBeNull();
  });

  it('does not inject into an attribute value that contains <head>', () => {
    const secured = injectContentSecurityPolicy('<div data-title="<head>">Hello</div>');

    const doc = parse(secured);
    expect(doc.querySelector('div')?.getAttribute('data-title')).toBe('<head>');
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
  });
});

describe('decodeHtmlContent', () => {
  it('decodes the url_encoded transport form and leaves other values alone', () => {
    const raw = '<div><span>Encoded Component</span></div>';

    expect(decodeHtmlContent(`url_encoded:${encodeURIComponent(raw)}`)).toBe(raw);
    expect(decodeHtmlContent(raw)).toBe(raw);
  });

  it('returns an empty string on malformed percent-encoding without throwing', () => {
    expect(decodeHtmlContent('url_encoded:%E0%A4%A')).toBe('');
  });
});

describe('prepareSrcdocContent', () => {
  it('decodes and secures the content', () => {
    const raw = '<html><head></head><body><span>Encoded Component</span></body></html>';

    const prepared = prepareSrcdocContent(`url_encoded:${encodeURIComponent(raw)}`);

    expect(prepared).toContain('<span>Encoded Component</span>');
    expect(prepared).toContain("connect-src 'none'");
  });

  it('returns null for empty content', () => {
    expect(prepareSrcdocContent('')).toBeNull();
    expect(prepareSrcdocContent('url_encoded:')).toBeNull();
  });
});
