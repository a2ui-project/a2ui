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
import {ImageApi} from '@a2ui/web_core/v0_9/basic_catalog';

/** Rough terminal footprint per image variant (columns x rows). */
const VARIANT_SIZE: Record<string, {width: number; height: number}> = {
  icon: {width: 6, height: 1},
  avatar: {width: 10, height: 3},
  smallFeature: {width: 16, height: 3},
  mediumFeature: {width: 24, height: 5},
  largeFeature: {width: 32, height: 7},
  header: {width: 40, height: 5},
};

/**
 * Images cannot be rasterized portably in a terminal, so this renders a
 * framed placeholder sized by variant, labeled with the accessibility
 * description (preferred) or the URL host/path.
 */
export const Image = createComponentImplementation(ImageApi, ({props}) => {
  const desc =
    typeof props.description === 'string' && props.description
      ? props.description
      : typeof props.url === 'string'
        ? props.url.replace(/^https?:\/\//, '')
        : 'image';
  const size = VARIANT_SIZE[props.variant ?? 'mediumFeature'] ?? VARIANT_SIZE['mediumFeature']!;

  if (props.variant === 'icon') {
    return <Text dimColor>[{desc.slice(0, 12)}]</Text>;
  }

  // Prefer intrinsic size over flex weight for terminal placeholders — a fixed
  // width + flexBasis:0 was collapsing sibling text columns to 1 character.
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      width={size.width}
      height={size.height}
      justifyContent="center"
      alignItems="center"
      flexShrink={0}
    >
      <Text dimColor wrap="truncate-end">
        🖼 {desc}
      </Text>
    </Box>
  );
});
