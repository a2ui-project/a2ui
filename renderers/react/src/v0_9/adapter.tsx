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

import React, {useRef, useSyncExternalStore, useCallback, memo, useEffect} from 'react';
import {
  type ComponentApi,
  type ComponentContext,
  GenericBinder,
  type InferredComponentApiSchemaType,
  type ResolveA2uiProps,
} from '@a2ui/web_core/v0_9';
import {LoadingPlaceholder, useNodeView} from './node-view';
import type {
  NodeViewProps,
  ReactA2uiComponentProps,
  ReactComponentImplementation,
} from './react_component_implementation';
import {toWebComponent} from './catalog/to_web_component';

// --- Component Factories ---

/**
 * Registers the Custom Element that wraps `implementation`, and returns the
 * implementation carrying that element's tag name.
 *
 * web_core resolves a node's children by tag name, so a React implementation
 * without one renders nothing once its parent is a Web Component. Registering
 * the element as the implementation is created, rather than on first render,
 * keeps the catalog complete before anything paints.
 */
function withElementWrapper(
  implementation: ReactComponentImplementation,
): ReactComponentImplementation {
  return {...implementation, tagName: toWebComponent(implementation).tagName};
}

/**
 * Creates a React component implementation using the deep generic binder.
 */
export function createComponentImplementation<Api extends ComponentApi>(
  api: Api,
  RenderComponent: React.FC<
    ReactA2uiComponentProps<ResolveA2uiProps<InferredComponentApiSchemaType<Api>>>
  >,
): ReactComponentImplementation {
  type Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;

  const MemoizedRender = memo(RenderComponent, (prev, next) => {
    if (prev.props !== next.props) return false;
    // The child index is rebuilt when a child arrives, leaves, or is
    // replaced; binder props don't change with it, so the builder's identity
    // is the only signal.
    if (prev.buildChild !== next.buildChild) return false;
    if (prev.context.componentModel.id !== next.context.componentModel.id) return false;
    if (prev.context.dataContext.path !== next.context.dataContext.path) return false;
    return true;
  });

  const ReactWrapper: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }> = ({context, buildChild}) => {
    const bindingRef = useRef<GenericBinder<Props> | null>(null);

    // Create or recreate the binder if the context object changes. Callers
    // memoize `context`, so a new reference means the component's model or its
    // data path changed.
    if (!bindingRef.current) {
      bindingRef.current = new GenericBinder<Props>(context, api.schema);
    } else if ((bindingRef.current as unknown as {context: ComponentContext}).context !== context) {
      bindingRef.current.dispose();
      bindingRef.current = new GenericBinder<Props>(context, api.schema);
    }
    const binding = bindingRef.current;

    const subscribe = useCallback(
      (callback: () => void) => {
        const sub = binding.subscribe(callback);
        return () => sub.unsubscribe();
      },
      [binding],
    );

    const getSnapshot = useCallback(() => binding.snapshot, [binding]);
    const props = useSyncExternalStore(subscribe, getSnapshot);

    // Prevent DataModel subscription leaks on unmount
    useEffect(() => {
      return () => binding.dispose();
    }, [binding]);

    return (
      <MemoizedRender props={props || ({} as Props)} buildChild={buildChild} context={context} />
    );
  };

  const NodeView: React.FC<NodeViewProps> = ({node, buildChild}) => {
    const {viewProps, context, viewBuildChild} = useNodeView(node, buildChild);
    if (!context) {
      return <LoadingPlaceholder componentId={node.componentId} />;
    }
    return (
      <MemoizedRender props={viewProps as Props} buildChild={viewBuildChild} context={context} />
    );
  };
  NodeView.displayName = `${api.name}.view`;

  return withElementWrapper({
    name: api.name,
    schema: api.schema,
    render: ReactWrapper,
    view: NodeView,
  });
}

/**
 * Creates a React component implementation that manages its own context bindings (no generic binder).
 */
export function createBinderlessComponentImplementation(
  api: ComponentApi,
  RenderComponent: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }>,
): ReactComponentImplementation {
  const NodeView: React.FC<NodeViewProps> = ({node, buildChild}) => {
    // The conversion's only role here is filling the child index; the
    // component binds its own values from the context, so its child ids are
    // raw component ids, not view tokens.
    const {context, rawBuildChild} = useNodeView(node, buildChild);
    if (!context) {
      return <LoadingPlaceholder componentId={node.componentId} />;
    }
    return <RenderComponent context={context} buildChild={rawBuildChild} />;
  };
  NodeView.displayName = `${api.name}.view`;

  return withElementWrapper({
    name: api.name,
    schema: api.schema,
    render: RenderComponent,
    view: NodeView,
  });
}
