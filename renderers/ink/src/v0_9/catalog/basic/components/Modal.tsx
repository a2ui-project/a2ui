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
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {ModalTriggerContext} from '../modal-trigger-context.js';

/**
 * Terminal modal. One focus target on the trigger row (▸): Enter/Space opens,
 * Esc closes. Nested Button triggers are not separately focusable (see
 * ModalTriggerContext) so Tab doesn't hit both the chevron and the button.
 * Content expands inline — terminals have no overlay layer.
 */
export const Modal = createComponentImplementation(ModalApi, ({props, buildChild}) => {
  const [isOpen, setIsOpen] = useState(false);
  const {isFocused} = useFocus();

  useInput(
    (input, key) => {
      if (key.escape && isOpen) {
        setIsOpen(false);
        return;
      }
      if (!isFocused) return;
      if (key.return || input === ' ') {
        setIsOpen(open => !open);
      }
    },
    {isActive: isFocused || isOpen},
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Text inverse={isFocused} color="magenta">
          {isOpen ? '▾' : '▸'}
        </Text>
        <ModalTriggerContext.Provider value={true}>
          {props.trigger ? buildChild(props.trigger) : null}
        </ModalTriggerContext.Provider>
      </Box>
      {isOpen ? (
        <Box borderStyle="double" borderColor="magenta" paddingX={1} flexDirection="column">
          {props.content ? buildChild(props.content) : null}
          <Text dimColor italic>
            Esc to dismiss
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
