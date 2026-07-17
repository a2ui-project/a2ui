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
import {type ComponentId} from '@a2ui/web_core/v0_9';
import {createComponentImplementation} from '../../../adapter.js';
import {ListApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {mapAlign, weightProps} from '../utils.js';

type ResolvedChildRef = ComponentId | {id: ComponentId; basePath: string};

export const List = createComponentImplementation(ListApi, ({props, buildChild}) => {
  const isHorizontal = props.direction === 'horizontal';
  const style = props.listStyle;
  const children: ResolvedChildRef[] = Array.isArray(props.children) ? props.children : [];

  return (
    <Box
      flexDirection={isHorizontal ? 'row' : 'column'}
      alignItems={mapAlign(props.align)}
      gap={1}
      {...weightProps(props.weight)}
    >
      {children.map((childRef, index) => {
        if (!childRef) return null;
        const isRef = typeof childRef !== 'string';
        const marker = style === 'ordered' ? `${index + 1}. ` : style === 'unordered' ? '• ' : '';
        const key = isRef ? `${childRef.id}-${childRef.basePath}` : `${childRef}-${index}`;
        const node = isRef ? buildChild(childRef.id, childRef.basePath) : buildChild(childRef);
        return (
          <Box key={key} flexDirection="row">
            {marker ? <Text dimColor>{marker}</Text> : null}
            {node}
          </Box>
        );
      })}
    </Box>
  );
});
