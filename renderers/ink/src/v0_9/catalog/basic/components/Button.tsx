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
import {ButtonApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';
import {useInModalTrigger} from '../modal-trigger-context.js';

/**
 * Terminal button. Activate with Enter or Space while focused (Tab cycles
 * focus). Variants:
 * - default:    [ label ] in cyan
 * - primary:    [ label ] in green (main call-to-action)
 * - borderless: underline chrome, no brackets (link-like)
 *
 * When rendered as a Modal trigger, focus is owned by the Modal — this button
 * stays visual-only so Tab doesn't register two stops.
 *
 * Note: `label` from buildChild is a component tree and must NOT be nested
 * inside Ink <Text> (Text only allows strings / nested Text).
 */
export const Button = createComponentImplementation(ButtonApi, ({props, buildChild}) => {
  const disabled = props.isValid === false;
  const inModalTrigger = useInModalTrigger();
  const borderless = props.variant === 'borderless';
  const {isFocused} = useFocus({isActive: !disabled && !inModalTrigger});
  const color = disabled ? 'gray' : props.variant === 'primary' ? 'green' : 'cyan';

  useInput(
    (input, key) => {
      // Defense in depth: never fire while checks fail, even if focus leaked.
      if (disabled) return;
      if (key.return || input === ' ') {
        props.action?.();
      }
    },
    {isActive: isFocused && !disabled && !inModalTrigger},
  );

  const label = props.child ? buildChild(props.child) : <Text color={color}>Button</Text>;

  return (
    <Box {...weightProps(props.weight)}>
      {borderless ? (
        <Text inverse={isFocused} underline color={color} dimColor={disabled}>
          {' '}
        </Text>
      ) : (
        <Text
          inverse={isFocused}
          color={color}
          dimColor={disabled}
          bold={props.variant === 'primary'}
        >
          [{' '}
        </Text>
      )}
      {label}
      {borderless ? (
        <Text inverse={isFocused} underline color={color} dimColor={disabled}>
          {' '}
        </Text>
      ) : (
        <Text
          inverse={isFocused}
          color={color}
          dimColor={disabled}
          bold={props.variant === 'primary'}
        >
          {' '}
          ]
        </Text>
      )}
    </Box>
  );
});
