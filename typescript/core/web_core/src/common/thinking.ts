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

// Inline code, a data path, or a term that only comes up when the model thinks
// about the protocol. A bare "surface" or "component" is left out, since the
// user's request may well be about a kitchen surface or a dishwasher component.
const A2UI_TALK = new RegExp(
  '`|\\$/|\\ba2ui|\\bjson|\\bschemas?\\b|\\bcatalogs?\\b|\\bdsl\\b|\\bsyntax\\b' +
    '|\\bdata ?models?\\b|\\bdata ?bindings?\\b|\\bsurface ?ids?\\b' +
    '|\\bcomponent ?ids?\\b|\\bcomponent trees?\\b|\\broot components?\\b' +
    '|\\bvariable names?\\b|\\bcreatesurface\\b|\\bupdatecomponents\\b' +
    '|\\bupdatedatamodel\\b|\\bdeletesurface\\b',
  'i',
);

// The whitespace after a sentence: after `.`, `!` or `?`, and any closing
// emphasis, quotes or brackets, as in `**Done.** Next`.
const SENTENCE_END = /(?<=[.!?])\s+|(?<=[.!?][*_"')\]])\s+|(?<=[.!?][*_"')\]]{2})\s+/;

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

const A2UI_TAG_LINE = /^\s*<a2ui(?:-json)?>\s*$/i;

/**
 * Removes the sentences of the model's thinking that are about A2UI.
 *
 * An app that shows the model's thinking while the user waits passes each
 * thought through this function, so the user reads about their request and not
 * about the format, its code or its data model. A sentence is removed when it
 * has inline code, a data path such as `$/form/name`, or a protocol term such
 * as A2UI, JSON, schema, catalog or data model. A fenced code block, or a block
 * between `<a2ui>` and `</a2ui>` lines, is removed whole. A line that loses
 * every sentence is removed too, along with the blank lines after it. A thought
 * with nothing to remove comes back unchanged.
 *
 * The terms also match a sentence about the user's own code or JSON, so an
 * agent whose users ask about code should show the thinking unfiltered.
 */
export function removeA2uiThinking(thinking: string): string {
  const lines: string[] = [];
  let afterRemovedLine = false;
  let blockEnd: string | undefined;
  for (const line of thinking.split('\n')) {
    const cr = line.endsWith('\r') ? '\r' : '';
    const text = cr ? line.slice(0, -1) : line;
    if (blockEnd !== undefined) {
      if (text.toLowerCase().includes(blockEnd)) {
        blockEnd = undefined;
      }
      afterRemovedLine = true;
      continue;
    }
    if (text.trimStart().startsWith('```')) {
      if (text.split('```').length === 2) {
        blockEnd = '```';
      }
      afterRemovedLine = true;
      continue;
    }
    if (A2UI_TAG_LINE.test(text)) {
      blockEnd = '</a2ui';
      afterRemovedLine = true;
      continue;
    }
    if (!text.trim()) {
      if (!afterRemovedLine) {
        lines.push(line);
      }
      continue;
    }
    const prefix = LIST_MARKER.exec(text)?.[0] ?? '';
    const sentences = text
      .slice(prefix.length)
      .split(SENTENCE_END)
      .filter(sentence => sentence);
    const kept = sentences.filter(sentence => !A2UI_TALK.test(sentence));
    afterRemovedLine = kept.length === 0;
    if (kept.length === sentences.length) {
      lines.push(line);
    } else if (kept.length > 0) {
      lines.push(prefix + kept.join(' ') + cr);
    }
  }
  return lines.join('\n');
}
