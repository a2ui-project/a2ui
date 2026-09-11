/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, {useRef, useCallback, useEffect, memo} from 'react';
import type {A2uiWebComponentElement, ComponentContext} from '@a2ui/web_core/v0_9';

export const WebComponentNode = memo(
  ({tagName, context}: {tagName: string; context: ComponentContext}) => {
    const elRef = useRef<HTMLElement | null>(null);
    const contextRef = useRef(context);
    contextRef.current = context;

    const setRef = useCallback((node: HTMLElement | null) => {
      elRef.current = node;
      if (node) {
        (node as A2uiWebComponentElement).context = contextRef.current;
      }
    }, []);

    useEffect(() => {
      if (elRef.current) {
        (elRef.current as A2uiWebComponentElement).context = context;
      }
    }, [context]);

    return React.createElement(tagName, {ref: setRef});
  },
);
WebComponentNode.displayName = 'WebComponentNode';
