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

  it('wraps a bare fragment in a full document', () => {
    const secured = injectContentSecurityPolicy('<button id="btn">Click me</button>');

    expect(secured).toMatch(/^<html>\s*<head>\s*<meta http-equiv="Content-Security-Policy"/);
    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    expect(doc.querySelector('#btn')?.textContent).toBe('Click me');
  });

  it('keeps author CSP meta tags after the injected one; they can only narrow it', () => {
    const secured = injectContentSecurityPolicy(
      '<html><head><meta http-equiv="Content-Security-Policy" content="connect-src *;">' +
        '<meta charset="utf-8"><title>Test</title></head><body></body></html>',
    );

    const doc = parse(secured);
    expect(cspContents(doc)).toEqual([SRCDOC_CONTENT_SECURITY_POLICY, 'connect-src *;']);
    expect(doc.querySelector('meta[charset]')).not.toBeNull();
  });

  it('keeps the doctype of a full document, after a leading comment, and without <html>', () => {
    for (const html of [
      '<!DOCTYPE html><html><head></head><body>x</body></html>',
      '<!-- generated --><!DOCTYPE html><html><head></head><body>x</body></html>',
      '<!DOCTYPE html><p>x</p>',
    ]) {
      const secured = injectContentSecurityPolicy(html);
      expect(secured.startsWith('<!DOCTYPE html>')).withContext(html).toBeTrue();
      expect(cspContents(parse(secured)))
        .withContext(html)
        .toEqual([SRCDOC_CONTENT_SECURITY_POLICY]);
    }
  });

  it('does not XML-escape < or & inside inline scripts and styles', () => {
    // `XMLSerializer` would turn these into `&lt;` / `&amp;`, which `srcdoc` parses as HTML
    // and hands to the script and style engines as broken JS and CSS.
    const secured = injectContentSecurityPolicy(
      '<style>.a > .b { color: red; }</style><script>if (a < b && c > d) {}</script>',
    );
    expect(secured).toContain('.a > .b { color: red; }');
    expect(secured).toContain('if (a < b && c > d) {}');
  });

  it('keeps body attributes of a document without an <html> tag', () => {
    const secured = injectContentSecurityPolicy(
      '<body class="dark" style="margin: 0"><p>x</p></body>',
    );
    const body = parse(secured).body;
    expect(body.className).toBe('dark');
    expect(body.getAttribute('style')).toBe('margin: 0');
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
