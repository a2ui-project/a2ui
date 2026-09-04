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

import {TestBed} from '@angular/core/testing';
import {MarkdownRenderer, DefaultMarkdownRenderer, provideMarkdownRenderer} from './markdown';

describe('MarkdownRenderer (v0.9)', () => {
  describe('DefaultMarkdownRenderer', () => {
    let renderer: DefaultMarkdownRenderer;

    beforeEach(() => {
      renderer = new DefaultMarkdownRenderer();
    });

    it('returns the markdown string as plain text fallback', async () => {
      const input = '# Heading\n**Bold text**';
      const result = await renderer.render(input);
      expect(result).toBe(input);
    });

    it('handles empty strings cleanly', async () => {
      const result = await renderer.render('');
      expect(result).toBe('');
    });
  });

  describe('provideMarkdownRenderer', () => {
    it('provides DefaultMarkdownRenderer when called without arguments', () => {
      TestBed.configureTestingModule({
        providers: [provideMarkdownRenderer()],
      });

      const renderer = TestBed.inject(MarkdownRenderer);
      expect(renderer).toBeInstanceOf(DefaultMarkdownRenderer);
    });

    it('provides custom renderer when a custom renderFn is passed', async () => {
      const customRenderFn = jasmine.createSpy('customRenderFn').and.resolveTo('<em>rendered</em>');

      TestBed.configureTestingModule({
        providers: [provideMarkdownRenderer(customRenderFn)],
      });

      const renderer = TestBed.inject(MarkdownRenderer);
      const output = await renderer.render('*input*');

      expect(customRenderFn).toHaveBeenCalledWith('*input*');
      expect(output).toBe('<em>rendered</em>');
    });
  });
});
