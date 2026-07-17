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
import {VideoApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

/** Video playback is unavailable in a terminal; shows the URL as a framed placeholder. */
export const Video = createComponentImplementation(VideoApi, ({props}) => {
  const url = typeof props.url === 'string' ? props.url : '';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} {...weightProps(props.weight)}>
      <Text dimColor wrap="truncate-end">
        ▶ video: {url || '(no url)'}
      </Text>
    </Box>
  );
});
