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

import {Box, Text} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {AudioPlayerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

/** Audio playback is unavailable in a terminal; shows the description or URL as a placeholder. */
export const AudioPlayer = createComponentImplementation(AudioPlayerApi, ({props}) => {
  const desc =
    typeof props.description === 'string' && props.description
      ? props.description
      : typeof props.url === 'string'
        ? props.url
        : '(no url)';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} {...weightProps(props.weight)}>
      <Text dimColor wrap="truncate-end">
        ♪ audio: {desc}
      </Text>
    </Box>
  );
});
