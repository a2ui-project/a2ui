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

import {Box, Text as InkText} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {textVariantStyle, stripMarkdown, weightProps} from '../utils.js';

export const Text = createComponentImplementation(TextApi, ({props}) => {
  const raw = typeof props.text === 'string' ? props.text : String(props.text ?? '');
  const text = stripMarkdown(raw);
  const style = textVariantStyle(props.variant);

  const node = <InkText {...style}>{text}</InkText>;

  // Only introduce a Box when weight participates in flex layout, so that
  // Text stays inline inside e.g. Button labels.
  if (typeof props.weight === 'number') {
    return <Box {...weightProps(props.weight)}>{node}</Box>;
  }
  return node;
});
