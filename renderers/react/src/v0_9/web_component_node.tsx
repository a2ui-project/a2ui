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
import type {ComponentNode} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  registerUniversalElement,
  type A2uiWebComponentElement,
} from '@a2ui/web_core/v0_9/universal';
import {type HostOwner, markReactRendered} from './host_registry';

function assign(element: A2uiWebComponentElement, node: ComponentNode): void {
  element.context = node.context;
  element.node = node;
}

/**
 * Renders a node as its implementation's custom element, the way web_core's
 * `renderA2uiNode` does: defines the element if needed, then hands it `node`
 * and `context`. `children` render inside the element; `owner` marks the
 * element as React-rendered for the `HostRegistry` (see `HostOwner`).
 */
export const WebComponentNode = memo(
  ({
    node,
    owner,
    children,
  }: {
    node: ComponentNode;
    owner?: HostOwner;
    children?: React.ReactNode;
  }) => {
    const implementation = node.impl;
    if (!isWebComponentImplementation(implementation)) {
      throw new Error(
        `A2UI catalog entry '${node.type}' has no element. A2uiSurface prepares the ` +
          `surface's default and available catalogs; this entry came from another catalog.`,
      );
    }
    registerUniversalElement(implementation);

    const elRef = useRef<A2uiWebComponentElement | null>(null);
    const nodeRef = useRef(node);
    nodeRef.current = node;

    const setRef = useCallback(
      (element: A2uiWebComponentElement | null) => {
        elRef.current = element;
        if (element) {
          // Before `node`: a host decides whether to register when it gets one.
          if (owner) markReactRendered(element, owner);
          assign(element, nodeRef.current);
        }
      },
      [owner],
    );

    useEffect(() => {
      if (elRef.current) {
        assign(elRef.current, node);
      }
    }, [node]);

    return React.createElement(implementation.tagName, {ref: setRef}, children);
  },
);
WebComponentNode.displayName = 'WebComponentNode';
