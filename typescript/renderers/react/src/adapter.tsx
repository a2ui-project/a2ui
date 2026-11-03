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
  type A2uiMetadata,
  type ComponentApi,
  type ComponentContext,
  GenericBinder,
  type InferredComponentApiSchemaType,
  type ResolveA2uiProps,
} from '@a2ui/web_core/v0_9';
import {accessibilityRefFor} from './catalog/host_accessibility';
import {useNodeView} from './node-view';
import type {
  NodeViewProps,
  ReactA2uiComponentProps,
  ReactComponentImplementation,
  ReactRenderProps,
} from './react_component_implementation';

// --- Component Factories ---

type MemoizedRenderInternalProps<Props> = {
  props: Props;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
  context: ComponentContext;
  accessibilityRef?: (element: Element | null) => void;
  metadataSnapshot: A2uiMetadata | undefined;
  hasReadMetadata: () => boolean;
  getMetadata: () => A2uiMetadata | undefined;
};

/**
 * Copies the `ComponentApi` fields of `api`. Spreading `api` instead would also copy fields of a
 * richer entry, such as the `tagName` and `element` of a Web Component implementation, and the
 * surface would then render that element instead of the React component.
 */
function componentApiFields(api: ComponentApi): ComponentApi {
  return {
    name: api.name,
    schema: api.schema,
    allowedParents: api.allowedParents,
    allowedChildren: api.allowedChildren,
    ...(api.metadata !== undefined ? {metadata: api.metadata} : {}),
  };
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

  const MemoizedRender = memo(
    ({
      props,
      buildChild,
      context,
      accessibilityRef,
      getMetadata,
    }: MemoizedRenderInternalProps<Props>) => {
      const componentProps = {
        props,
        buildChild,
        context,
        accessibilityRef,
      } as ReactA2uiComponentProps<Props>;
      Object.defineProperty(componentProps, 'metadata', {
        enumerable: true,
        get: getMetadata,
      });
      return RenderComponent(componentProps);
    },
    (prev, next) => {
      if (prev.props !== next.props) return false;
      if (prev.hasReadMetadata() && prev.metadataSnapshot !== next.metadataSnapshot) return false;
      // The child index is rebuilt when a child arrives, leaves, or is
      // replaced; binder props don't change with it, so the builder's identity
      // is the only signal.
      if (prev.buildChild !== next.buildChild) return false;
      if (prev.accessibilityRef !== next.accessibilityRef) return false;
      if (prev.context.componentModel.id !== next.context.componentModel.id) return false;
      if (prev.context.dataContext.path !== next.context.dataContext.path) return false;
      return true;
    },
  );
  MemoizedRender.displayName = `${api.name}.memo`;

  const ReactWrapper: React.FC<ReactRenderProps> = ({context, buildChild}) => {
    const bindingRef = useRef<GenericBinder<Props> | null>(null);
    const metadataReadRef = useRef(false);

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

    const subscribeMetadata = useCallback(
      (callback: () => void) => {
        const sub = context.componentModel.onMetadataChanged.subscribe(() => {
          if (metadataReadRef.current) {
            callback();
          }
        });
        return () => sub.unsubscribe();
      },
      [context.componentModel],
    );
    const getMetadataSnapshot = useCallback(
      () => context.componentModel.metadata,
      [context.componentModel],
    );
    const metadataSnapshot = useSyncExternalStore(subscribeMetadata, getMetadataSnapshot);
    const hasReadMetadata = useCallback(() => metadataReadRef.current, []);
    const getMetadata = useCallback(() => {
      metadataReadRef.current = true;
      return context.componentModel.metadata;
    }, [context.componentModel]);

    // Prevent DataModel subscription leaks on unmount
    useEffect(() => {
      return () => binding.dispose();
    }, [binding]);

    return (
      <MemoizedRender
        props={props || ({} as Props)}
        buildChild={buildChild}
        context={context}
        metadataSnapshot={metadataSnapshot}
        hasReadMetadata={hasReadMetadata}
        getMetadata={getMetadata}
      />
    );
  };

  const NodeView: React.FC<NodeViewProps> = ({node, buildChild}) => {
    const viewState = useNodeView(node, buildChild);
    return (
      <MemoizedRender
        props={viewState.viewProps as Props}
        buildChild={viewState.viewBuildChild}
        context={viewState.context}
        accessibilityRef={accessibilityRefFor(node)}
        metadataSnapshot={viewState.metadataSnapshot}
        hasReadMetadata={viewState.hasReadMetadata}
        getMetadata={() => viewState.metadata}
      />
    );
  };
  NodeView.displayName = `${api.name}.view`;

  return {
    ...componentApiFields(api),
    render: ReactWrapper,
    view: NodeView,
  };
}

/**
 * Creates a React component implementation that manages its own context bindings (no generic binder).
 */
export function createBinderlessComponentImplementation(
  api: ComponentApi,
  RenderComponent: React.FC<ReactRenderProps>,
): ReactComponentImplementation {
  const NodeView: React.FC<NodeViewProps> = ({node, buildChild}) => {
    // The conversion's only role here is filling the child index; the
    // component binds its own values from the context, so its child ids are
    // raw component ids, not view tokens.
    const viewState = useNodeView(node, buildChild);
    const renderProps = {
      context: viewState.context,
      buildChild: viewState.rawBuildChild,
      accessibilityRef: accessibilityRefFor(node),
    } as ReactRenderProps;
    Object.defineProperty(renderProps, 'metadata', {
      enumerable: true,
      get: () => viewState.metadata,
    });
    return RenderComponent(renderProps);
  };
  NodeView.displayName = `${api.name}.view`;

  return {
    ...componentApiFields(api),
    render: RenderComponent,
    view: NodeView,
  };
}
