/**
 * Copyright 2026 Google LLC
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

import {memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject, mergeClassMaps} from '../../lib/utils';

type UsageHint = 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';
type FitMode = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

/**
 * Image component - renders an image from a URL with optional sizing and fit modes.
 *
 * Supports usageHint values: icon, avatar, smallFeature, mediumFeature, largeFeature, header
 * Supports fit values: contain, cover, fill, none, scale-down (maps to object-fit via CSS variable)
 */
export const Image = memo(function Image({node, surfaceId}: A2UIComponentProps<Types.ImageNode>) {
  const {theme, resolveString} = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const url = resolveString(props.url);
  const altText = resolveString(
    (props as Record<string, unknown>).altText as Types.StringValue | undefined,
  );
  const usageHint = props.usageHint as UsageHint | undefined;
  const fit = (props.fit as FitMode) ?? 'fill';

  // Get merged classes for section (matches Lit's Styles.merge)
  const classes = mergeClassMaps(
    theme.components.Image.all,
    usageHint ? theme.components.Image[usageHint] : {},
  );

  // Build style object with object-fit as CSS variable (matches Lit)
  const style: React.CSSProperties = {
    ...stylesToObject(theme.additionalStyles?.Image),
    '--object-fit': fit,
  } as React.CSSProperties;

  if (!url) {
    return null;
  }

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-image" style={hostStyle}>
      <section className={classMapToString(classes)} style={style}>
        <img src={url} alt={altText || ''} />
      </section>
    </div>
  );
});

export default Image;
