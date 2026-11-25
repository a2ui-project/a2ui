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

// @vitest-environment jsdom

import '@angular/compiler';

import {provideMarkdownRenderer as provideV08MarkdownRenderer} from '@a2ui/angular';
import {
  MarkdownRenderer,
  provideMarkdownRenderer as provideV09MarkdownRenderer,
} from '@a2ui/angular/v0_9';
import {PLATFORM_ID, Provider} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {DomSanitizer} from '@angular/platform-browser';
import {BrowserTestingModule, platformBrowserTesting} from '@angular/platform-browser/testing';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {MARKDOWN_RENDERER_SERVICE} from '../interfaces/markdown-renderer-service';
import {SanitizerMarkdownRendererService} from './sanitizer-markdown-renderer-service';

describe('SanitizerMarkdownRendererService', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  function createService(extraProviders: Provider[] = []) {
    TestBed.configureTestingModule({
      providers: [SanitizerMarkdownRendererService, ...extraProviders],
    });
    const sanitizer = TestBed.inject(DomSanitizer);
    const bypassSpy = vi.spyOn(sanitizer, 'bypassSecurityTrustHtml');
    const service = TestBed.inject(SanitizerMarkdownRendererService);
    return {sanitizer, bypassSpy, service};
  }

  function parseHtml(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('does not bypass Angular HTML sanitization and neutralizes img onerror XSS payloads', async () => {
    const {service, bypassSpy} = createService();
    const payload = '<img src=x onerror="alert(1)">';

    const result = await service.render(payload);

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');

    const doc = parseHtml(result);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent?.trim()).toBe(payload);
  });

  it('neutralizes script tags, svg onload handlers, and javascript: links', async () => {
    const {service, bypassSpy} = createService();

    const scriptResult = await service.render('<script>alert("xss")</script>hello');
    const svgResult = await service.render('<svg onload="alert(1)"></svg>');
    const linkResult = await service.render('[click me](javascript:alert(1))');

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof scriptResult).toBe('string');
    expect(typeof svgResult).toBe('string');
    expect(typeof linkResult).toBe('string');

    const scriptDoc = parseHtml(scriptResult);
    expect(scriptDoc.querySelector('script')).toBeNull();
    expect(scriptDoc.body.textContent).toContain('hello');

    const svgDoc = parseHtml(svgResult);
    expect(svgDoc.querySelector('svg')).toBeNull();

    const linkDoc = parseHtml(linkResult);
    const anchors = Array.from(linkDoc.querySelectorAll('a'));
    expect(anchors.length).toBe(0);
    expect(linkDoc.body.textContent).toContain('click me');
  });

  it('renders safe Markdown formatting and HTTPS links', async () => {
    const {service, bypassSpy} = createService();

    const result = await service.render('Hello **world** and [docs](https://example.com)');

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');

    const doc = parseHtml(result);
    const strong = doc.querySelector('strong');
    expect(strong?.textContent).toBe('world');

    const link = doc.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.textContent).toBe('docs');
  });

  it('uses a custom renderer registered via @a2ui/angular/v0_9 provideMarkdownRenderer', async () => {
    const {service, bypassSpy} = createService([
      provideV09MarkdownRenderer(async () => '<p>CUSTOM-V09</p>'),
    ]);

    const result = await service.render('**ignored**');

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(result).toBe('<p>CUSTOM-V09</p>');
  });

  it('ignores the separate v0.8 @a2ui/angular provideMarkdownRenderer token and falls back to DefaultMarkdownRenderer', async () => {
    const {service, bypassSpy} = createService([
      provideV08MarkdownRenderer(async () => '<p>CUSTOM-V08</p>'),
    ]);

    const result = await service.render('Hello **world**');

    expect(bypassSpy).not.toHaveBeenCalled();
    const doc = parseHtml(result);
    expect(doc.querySelector('strong')?.textContent).toBe('world');
    expect(doc.body.textContent).not.toContain('CUSTOM-V08');
  });

  it('sanitizes unsanitized HTML returned by a custom MarkdownRenderer via Angular DomSanitizer', async () => {
    const unsafeRenderer: MarkdownRenderer = {
      render: async () => '<img src="x" onerror="alert(1)"><script>alert(2)</script><p>safe</p>',
    };
    const {service, bypassSpy} = createService([
      {provide: MarkdownRenderer, useValue: unsafeRenderer},
    ]);

    const result = await service.render('ignored');

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');

    const doc = parseHtml(result);
    expect(doc.querySelector('script')).toBeNull();
    const img = doc.querySelector('img');
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('safe');
  });

  it('escapes raw text when a renderer returns its input unchanged (pass-through fallback)', async () => {
    const passThroughRenderer: MarkdownRenderer = {
      render: async markdown => markdown,
    };
    const {service, bypassSpy} = createService([
      {provide: MarkdownRenderer, useValue: passThroughRenderer},
    ]);

    const htmlPayload =
      '<img src="https://evil.example/p"><a href="https://evil.example">Sign in</a><h1>Notice</h1>';
    const htmlResult = await service.render(htmlPayload);
    const genericsPayload = 'Use List<String> when a < b and c > d';
    const genericsResult = await service.render(genericsPayload);

    expect(bypassSpy).not.toHaveBeenCalled();

    const htmlDoc = parseHtml(htmlResult);
    expect(htmlDoc.querySelector('img')).toBeNull();
    expect(htmlDoc.querySelector('a')).toBeNull();
    expect(htmlDoc.querySelector('h1')).toBeNull();
    expect(htmlDoc.body.textContent).toBe(htmlPayload);

    const genericsDoc = parseHtml(genericsResult);
    expect(genericsDoc.body.textContent).toBe(genericsPayload);
  });

  it('escapes raw HTML on server platforms without invoking DefaultMarkdownRenderer', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const {service, bypassSpy} = createService([{provide: PLATFORM_ID, useValue: 'server'}]);
    const payload = '<img src="https://evil.example/track" onerror="alert(1)"> & List<String>';

    const result = await service.render(payload);

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    const doc = parseHtml(result);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent).toBe(payload);
  });

  it('falls back to escaped text when a custom MarkdownRenderer rejects', async () => {
    const failingRenderer: MarkdownRenderer = {
      render: () => Promise.reject(new Error('renderer failure')),
    };
    const {service, bypassSpy} = createService([
      {provide: MarkdownRenderer, useValue: failingRenderer},
    ]);
    const payload = '<img src=x onerror="alert(1)">';

    const result = await service.render(payload);

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');

    const doc = parseHtml(result);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent).toBe(payload);
  });

  it('wires SanitizerMarkdownRendererService via the MARKDOWN_RENDERER_SERVICE root factory', async () => {
    TestBed.configureTestingModule({});
    const sanitizer = TestBed.inject(DomSanitizer);
    const bypassSpy = vi.spyOn(sanitizer, 'bypassSecurityTrustHtml');
    const service = TestBed.inject(MARKDOWN_RENDERER_SERVICE);
    const payload = '<img src=x onerror="alert(1)">';

    expect(service).toBeInstanceOf(SanitizerMarkdownRendererService);

    const result = await service.render(payload);

    expect(bypassSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');

    const doc = parseHtml(result as string);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent?.trim()).toBe(payload);
  });
});
