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

/**
 * Preparation of the inline HTML a `WebAppFrameSrcdoc` component renders: decoding of the
 * `url_encoded:` transport form and injection of the Content Security Policy the WebApp iframe
 * component specification requires for untrusted markup.
 */

/** Prefix of an `htmlContent` value that was `encodeURIComponent`-encoded for transport. */
export const URL_ENCODED_PREFIX = 'url_encoded:';

/**
 * Policy injected into every inline document. It confines the document to itself: no network
 * (`connect-src 'none'`), no form submission (`form-action 'none'`), no base URL hijacking
 * (`base-uri 'none'`), no plugins or nested frames (`object-src`, `frame-src`); scripts and styles
 * may be inline or `data:` URIs, which model-generated applications need.
 */
export const SRCDOC_CONTENT_SECURITY_POLICY =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none';";

/**
 * Capture-phase click handler that keeps hyperlinks from navigating the inner frame, which CSP
 * does not govern and which would otherwise let markup exfiltrate data in a URL. The click is
 * reported to the parent as an `open_url` action, so a host that authorizes that action can open
 * the link itself.
 */
const LINK_INTERCEPTOR_SCRIPT = `<script>
      document.addEventListener('click', (e) => {
        const anchor = e.target.closest('a');
        if (anchor && anchor.href) {
          const href = anchor.getAttribute('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({
              type: 'a2ui_action',
              action: 'open_url',
              data: { url: anchor.href }
            }, '*');
          }
        }
      }, true);
    </script>`;

/** Decodes the `url_encoded:` transport form; other values are returned unchanged. */
export function decodeHtmlContent(htmlContent: string): string {
  if (htmlContent.startsWith(URL_ENCODED_PREFIX)) {
    try {
      return decodeURIComponent(htmlContent.substring(URL_ENCODED_PREFIX.length));
    } catch (error) {
      console.warn('Failed to decode URL-encoded HTML content:', error);
      return '';
    }
  }
  return htmlContent;
}

/**
 * Returns the markup with {@link SRCDOC_CONTENT_SECURITY_POLICY} and the link interceptor in its
 * `<head>`. Author-supplied CSP meta tags are removed first, so they can neither relax the policy
 * nor break the rendering with a stricter one. A missing `<head>` is created inside `<html>`, and
 * a bare fragment is prefixed with one.
 */
export function injectContentSecurityPolicy(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')) {
    el.remove();
  }

  const cspMeta = doc.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute('content', SRCDOC_CONTENT_SECURITY_POLICY);

  const tempDiv = doc.createElement('div');
  tempDiv.innerHTML = LINK_INTERCEPTOR_SCRIPT;
  const script = tempDiv.querySelector('script');
  if (script) {
    doc.head.insertBefore(script, doc.head.firstChild);
  }
  doc.head.insertBefore(cspMeta, doc.head.firstChild);

  if (
    /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>\s*)*(?:<!--[\s\S]*?-->\s*)*<html[\s>]/i.test(
      html,
    )
  ) {
    return `${/^\s*<!doctype\s+html\s*>/i.test(html) ? '<!DOCTYPE html>\n' : ''}${doc.documentElement.outerHTML}`;
  }
  return `${doc.head.outerHTML}\n${doc.body.innerHTML}`;
}

/**
 * The document the proxy loads for an `htmlContent` value: decoded and secured. Returns null for
 * an empty value, which loads nothing.
 */
export function prepareSrcdocContent(htmlContent: string): string | null {
  const decoded = decodeHtmlContent(htmlContent);
  return decoded === '' ? null : injectContentSecurityPolicy(decoded);
}
