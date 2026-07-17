/**
 * Copyright 2026 kokoro-ele
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

import type {BoxProps, TextProps} from 'ink';

export const mapJustify = (j?: string): BoxProps['justifyContent'] => {
  switch (j) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'spaceAround':
      return 'space-around';
    case 'spaceBetween':
      return 'space-between';
    case 'spaceEvenly':
      return 'space-evenly';
    case 'start':
    case 'stretch':
    default:
      return 'flex-start';
  }
};

export const mapAlign = (a?: string): BoxProps['alignItems'] => {
  switch (a) {
    case 'start':
      return 'flex-start';
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'stretch':
    default:
      return 'stretch';
  }
};

/**
 * Maps the A2UI `weight` property (flex-grow semantics) to Ink Box flex props.
 * Per the basic catalog guide, weight is only meaningful on direct children of
 * Row/Column; components apply it to their own root container.
 *
 * IMPORTANT: Do NOT set `flexBasis: 0` here. In Ink/Yoga, a zero basis inside a
 * parent with an indefinite width (nested Card/List/Row is common) collapses
 * the child to ~1 column; Text with wrap then stacks one character per line.
 */
export const weightProps = (weight?: number): Pick<BoxProps, 'flexGrow'> => {
  if (typeof weight !== 'number') return {};
  return {flexGrow: weight};
};

/**
 * Terminal fallback for Markdown per the basic catalog implementation guide:
 * no Markdown renderer is available, so strip common markers to keep the text
 * legible instead of showing raw `**`/`#`/link syntax.
 */
export const stripMarkdown = (text: string): string => {
  return (
    text
      // links: [label](url) -> label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // bold / italic markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      // inline code
      .replace(/`([^`]+)`/g, '$1')
      // heading markers at line start
      .replace(/^#{1,6}\s+/gm, '')
  );
};

/**
 * Typographic mapping for Text variants. Terminals have a single font size,
 * so heading levels are expressed with weight/underline/color instead.
 */
export const textVariantStyle = (variant?: string): Partial<TextProps> => {
  switch (variant) {
    case 'h1':
      return {bold: true, underline: true, color: 'cyan'};
    case 'h2':
      return {bold: true, color: 'cyan'};
    case 'h3':
      return {bold: true, color: 'cyanBright'};
    case 'h4':
    case 'h5':
      return {bold: true};
    case 'caption':
      return {dimColor: true, italic: true};
    default:
      return {};
  }
};
