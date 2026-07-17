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

import {Box, Text, useFocus, useInput} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {CheckBoxApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

/** Terminal checkbox. Toggle with Enter or Space while focused. */
export const CheckBox = createComponentImplementation(CheckBoxApi, ({props}) => {
  const checked = !!props.value;
  const {isFocused} = useFocus();
  const errors = props.validationErrors ?? [];
  const label = typeof props.label === 'string' ? props.label : String(props.label ?? '');

  useInput(
    (input, key) => {
      if (key.return || input === ' ') {
        props.setValue?.(!checked);
      }
    },
    {isActive: isFocused},
  );

  return (
    <Box flexDirection="column" {...weightProps(props.weight)}>
      <Text inverse={isFocused} color={errors.length > 0 ? 'red' : checked ? 'green' : undefined}>
        [{checked ? '✓' : ' '}] {label}
      </Text>
      {errors.map(error => (
        <Text key={error} color="red">
          ✗ {error}
        </Text>
      ))}
    </Box>
  );
});
