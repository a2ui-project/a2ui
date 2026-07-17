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

import {useState} from 'react';
import {Box, Text, useFocus, useInput} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

interface ResolvedOption {
  label: unknown;
  value: string;
}

function ChoiceOption({
  label,
  selected,
  exclusive,
  chips,
  onToggle,
}: {
  label: string;
  selected: boolean;
  exclusive: boolean;
  chips: boolean;
  onToggle: () => void;
}) {
  const {isFocused} = useFocus();
  useInput(
    (input, key) => {
      if (key.return || input === ' ') onToggle();
    },
    {isActive: isFocused},
  );
  if (chips) {
    return (
      <Text inverse={isFocused || selected} color={selected ? 'green' : 'cyan'}>
        {' '}
        {label}{' '}
      </Text>
    );
  }
  const mark = exclusive ? (selected ? '(•)' : '( )') : selected ? '[✓]' : '[ ]';
  return (
    <Text inverse={isFocused} color={selected ? 'green' : undefined}>
      {mark} {label}
    </Text>
  );
}

/**
 * Terminal choice picker. Tab moves between options; Enter or Space toggles
 * the focused option. 'chips' displayStyle lays options out horizontally.
 */
export const ChoicePicker = createComponentImplementation(ChoicePickerApi, ({props}) => {
  const [filter, setFilter] = useState('');
  const {isFocused: filterFocused} = useFocus({isActive: props.filterable === true});
  const values = Array.isArray(props.value) ? props.value : [];
  const isMutuallyExclusive = props.variant !== 'multipleSelection';
  const chips = props.displayStyle === 'chips';
  const groupLabel =
    typeof props.label === 'string' ? props.label : props.label ? String(props.label) : '';
  const errors = props.validationErrors ?? [];

  const onToggle = (val: string) => {
    if (isMutuallyExclusive) {
      props.setValue?.([val]);
    } else {
      const next = values.includes(val)
        ? values.filter((v: string) => v !== val)
        : [...values, val];
      props.setValue?.(next);
    }
  };

  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        setFilter(f => f.slice(0, -1));
        return;
      }
      if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) return;
      if (input && !key.ctrl && !key.meta) setFilter(f => f + input);
    },
    {isActive: filterFocused && props.filterable === true},
  );

  const allOptions: ResolvedOption[] = Array.isArray(props.options) ? props.options : [];
  const options = allOptions.filter(
    opt =>
      !props.filterable ||
      filter === '' ||
      String(opt.label).toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Box flexDirection="column" gap={chips ? 0 : 1} {...weightProps(props.weight)}>
      {groupLabel ? <Text bold>{groupLabel}</Text> : null}
      {props.filterable ? (
        <Text inverse={filterFocused} dimColor={!filterFocused}>
          ⌕ {filter || 'type to filter'}
        </Text>
      ) : null}
      <Box flexDirection={chips ? 'row' : 'column'} gap={1} flexWrap={chips ? 'wrap' : undefined}>
        {options.map(opt => (
          <ChoiceOption
            key={opt.value}
            label={String(opt.label)}
            selected={values.includes(opt.value)}
            exclusive={isMutuallyExclusive}
            chips={chips}
            onToggle={() => onToggle(opt.value)}
          />
        ))}
      </Box>
      {errors.map(error => (
        <Text key={error} color="red">
          ✗ {error}
        </Text>
      ))}
    </Box>
  );
});
