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
import {TextFieldApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

const NUMBER_CHARS = /^[0-9.,\-+]$/;

/**
 * Terminal text field. Focus with Tab, then type to edit; Backspace deletes.
 * Variant handling:
 * - obscured: masks the value with '*'
 * - number:   only accepts numeric characters
 * - longText: same single-line editor (terminal limitation), but wraps
 */
export const TextField = createComponentImplementation(TextFieldApi, ({props}) => {
  const {isFocused} = useFocus();
  const value = typeof props.value === 'string' ? props.value : String(props.value ?? '');
  const errors = props.validationErrors ?? [];
  const hasError = errors.length > 0;
  const display = props.variant === 'obscured' ? '*'.repeat([...value].length) : value;

  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        props.setValue?.(value.slice(0, -1));
        return;
      }
      // Leave navigation keys to Ink's focus manager / parent handlers.
      if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) {
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      if (props.variant === 'number' && ![...input].every(ch => NUMBER_CHARS.test(ch))) {
        return;
      }
      props.setValue?.(value + input);
    },
    {isActive: isFocused},
  );

  return (
    <Box flexDirection="column" {...weightProps(props.weight)}>
      {props.label ? (
        <Text dimColor={!isFocused} color={isFocused ? 'cyan' : undefined}>
          {typeof props.label === 'string' ? props.label : String(props.label)}
        </Text>
      ) : null}
      <Box
        borderStyle="single"
        borderColor={hasError ? 'red' : isFocused ? 'cyan' : 'gray'}
        paddingX={1}
      >
        <Text
          color={isFocused ? 'white' : 'gray'}
          wrap={props.variant === 'longText' ? 'wrap' : 'truncate-start'}
        >
          {display}
          {isFocused ? <Text color="cyan">█</Text> : display ? '' : ' '}
        </Text>
      </Box>
      {errors.map(error => (
        <Text key={error} color="red">
          ✗ {error}
        </Text>
      ))}
    </Box>
  );
});
