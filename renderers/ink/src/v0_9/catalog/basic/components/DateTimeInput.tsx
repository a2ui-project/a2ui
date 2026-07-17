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
import {DateTimeInputApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

const ISO_CHARS = /^[0-9T:\-+.Z ]$/i;

/**
 * Terminal date/time input. There is no native picker, so the ISO 8601 value
 * is edited as text with a format hint (e.g. 2026-07-16 or 14:30).
 */
export const DateTimeInput = createComponentImplementation(DateTimeInputApi, ({props}) => {
  const {isFocused} = useFocus();
  const value = typeof props.value === 'string' ? props.value : String(props.value ?? '');
  const label =
    typeof props.label === 'string' ? props.label : props.label ? String(props.label) : '';
  const errors = props.validationErrors ?? [];

  const formatHint = [props.enableDate ? 'YYYY-MM-DD' : null, props.enableTime ? 'HH:MM' : null]
    .filter(Boolean)
    .join('T');

  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        props.setValue?.(value.slice(0, -1));
        return;
      }
      if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) return;
      if (!input || key.ctrl || key.meta) return;
      if (![...input].every(ch => ISO_CHARS.test(ch))) return;
      props.setValue?.(value + input);
    },
    {isActive: isFocused},
  );

  // The spec requires at least one of enableDate/enableTime; render nothing
  // (after hooks) if the agent enabled neither.
  if (!(props.enableDate || props.enableTime)) return null;

  return (
    <Box flexDirection="column" {...weightProps(props.weight)}>
      {label ? (
        <Text dimColor={!isFocused} color={isFocused ? 'cyan' : undefined}>
          {label}
        </Text>
      ) : null}
      <Box
        borderStyle="single"
        borderColor={errors.length > 0 ? 'red' : isFocused ? 'cyan' : 'gray'}
        paddingX={1}
      >
        <Text>
          {value || <Text dimColor>{formatHint}</Text>}
          {isFocused ? <Text color="cyan">█</Text> : null}
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
