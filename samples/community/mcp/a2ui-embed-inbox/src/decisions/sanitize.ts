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
 * Email text is untrusted. These helpers make it safe to show (no links,
 * images or HTML reach the card) and to quote to the model (it can never
 * close the tag that marks it as data).
 */

/** Longest email excerpt the Details dialog shows. */
export const EXCERPT_LENGTH = 240;

/** The host of a URL, or `a link` when it doesn't parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'a link';
  }
}

/**
 * Email markdown for the Details dialog: images dropped, links replaced by
 * their host in code (so nothing is clickable, including phishing links),
 * raw HTML left as text, cut to {@link EXCERPT_LENGTH} characters.
 */
export function sanitizeEmailMarkdown(body: string, max = EXCERPT_LENGTH): string {
  let text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '(image removed)')
    .replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_, label: string, url: string) => {
      return `${label.replace(/[[\]`]/g, '')} (link to \`${hostOf(url)}\`)`;
    })
    .replace(/(?<![`(])\bhttps?:\/\/[^\s)>\]]+/g, url => `\`${hostOf(url)}\``)
    .replace(/</g, '&lt;');
  if (text.length > max) {
    text = `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
  }
  return text.trim();
}

/** Escapes markdown syntax so `text` renders literally inside a markdown `Text`. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, char => `\\${char}`);
}

/**
 * Quotes untrusted text for a prompt inside `<untrusted_email>` tags: angle
 * brackets become look-alikes so the text can't close or open a tag.
 */
export function quoteForPrompt(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}
