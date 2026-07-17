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

import {Box} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {CardApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

export const Card = createComponentImplementation(CardApi, ({props, buildChild}) => {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      {...weightProps(props.weight)}
    >
      {props.child ? buildChild(props.child) : null}
    </Box>
  );
});
