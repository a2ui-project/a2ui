/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {useState, useEffect} from 'react';
import {useMarkdownRenderer} from '../context/MarkdownContext';
import type {MarkdownRendererOptions} from '@a2ui/web_core/types/types';

let warningLogged = false;

export function useMarkdown(text: string, options?: MarkdownRendererOptions) {
  const renderer = useMarkdownRenderer();
  const [html, setHtml] = useState<string | null>(null);

  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!renderer) {
      if (!warningLogged) {
        console.warn(
          '[useMarkdown]',
          "can't render markdown because no markdown renderer is configured.\n",
          'Use `@a2ui/markdown-it`, or your own markdown renderer.',
        );
        warningLogged = true;
      }
      setHtml(null);
      return;
    }

    let active = true;
    const parsedOptions = optionsKey ? JSON.parse(optionsKey) : undefined;

    renderer(text, parsedOptions)
      .then(result => {
        if (active) {
          setHtml(result);
        }
      })
      .catch(err => {
        console.error('[useMarkdown] Render failed:', err);
      });

    return () => {
      active = false;
    };
  }, [text, renderer, optionsKey]);

  return html;
}
