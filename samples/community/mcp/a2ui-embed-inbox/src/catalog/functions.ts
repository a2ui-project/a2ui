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

/** Catalog functions of the inbox sample. */

import {z} from 'zod';

import {createFunctionImplementation, spec} from '@a2ui/web_core/v1_0';

/**
 * `prefix` plus the text for the selected option: `texts[choice]`, where
 * `choice` is a ChoicePicker value (an array whose first item is the option)
 * or an option string; `fallback` (default: empty) when there is no text for
 * it. Rows bind their reason and "what happens" lines to it, so they follow
 * the choice live.
 */
export function textForChoice(
  texts: unknown,
  choice: unknown,
  fallback: unknown,
  prefix: unknown = '',
): string {
  const option = Array.isArray(choice) ? choice[0] : choice;
  const lead = typeof prefix === 'string' ? prefix : '';
  if (texts && typeof texts === 'object' && typeof option === 'string') {
    const text = (texts as Record<string, unknown>)[option];
    if (typeof text === 'string') return `${lead}${text}`;
  }
  return typeof fallback === 'string' ? fallback : '';
}

export const byChoice = createFunctionImplementation(
  {
    name: 'byChoice',
    returnType: 'string',
    description:
      'Returns prefix plus the text for the selected option: texts[choice], where choice is a ChoicePicker value (its first item) or an option string, else fallback.',
    schema: spec(
      z
        .object({
          texts: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|An object of texts keyed by option value.'),
          choice: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicValue|The selected option: a ChoicePicker value or a string.',
            ),
          fallback: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicString|Optional text when the option has none (default: empty).',
            )
            .optional(),
          prefix: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicString|Optional text before the selected text (default: empty).',
            )
            .optional(),
        })
        .strict(),
      {required: ['texts', 'choice'], closure: 'unevaluatedProperties'},
    ),
  },
  args => textForChoice(args.texts, args.choice, args.fallback, args.prefix),
);
