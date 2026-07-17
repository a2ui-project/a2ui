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
import {SliderApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

const BAR_WIDTH = 20;

/**
 * Terminal slider. While focused, ←/→ adjust by one step. The step defaults
 * to 1/20 of the range (one bar cell) when not specified by the agent.
 */
export const Slider = createComponentImplementation(SliderApi, ({props}) => {
  const min = typeof props.min === 'number' ? props.min : 0;
  const max = typeof props.max === 'number' ? props.max : 100;
  const span = Math.max(Number.EPSILON, max - min);
  const step = typeof props.step === 'number' && props.step > 0 ? props.step : span / BAR_WIDTH;
  const value = typeof props.value === 'number' ? props.value : min;
  const {isFocused} = useFocus();
  const label =
    typeof props.label === 'string' ? props.label : props.label ? String(props.label) : '';

  useInput(
    (_input, key) => {
      // Round to the step grid to avoid floating point drift.
      const snap = (v: number) => Math.round(v / step) * step;
      if (key.leftArrow) {
        props.setValue?.(Math.max(min, snap(value - step)));
      } else if (key.rightArrow) {
        props.setValue?.(Math.min(max, snap(value + step)));
      }
    },
    {isActive: isFocused},
  );

  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(((value - min) / span) * BAR_WIDTH)));
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);

  return (
    <Box flexDirection="column" {...weightProps(props.weight)}>
      <Text>
        {label ? `${label} ` : ''}
        <Text dimColor>
          {min} ≤ {Number.isInteger(value) ? value : value.toFixed(2)} ≤ {max}
        </Text>
      </Text>
      <Text inverse={isFocused} color="cyan">
        [{bar}]
      </Text>
      {isFocused ? <Text dimColor>←/→ to adjust</Text> : null}
    </Box>
  );
});
