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

import React, {useMemo, useSyncExternalStore, useCallback, memo, useEffect} from 'react';
import {type ComponentContext, GenericBinder} from '@a2ui/web_core/v0_9';
import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from '@a2ui/web_core/v0_9';

export interface InkComponentImplementation extends ComponentApi {
  /** The framework-specific rendering wrapper. */
  render: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }>;
}

export type InkA2uiComponentProps<T> = {
  props: T;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
  context: ComponentContext;
};

/**
 * Creates an Ink component implementation using the deep generic binder.
 */
export function createComponentImplementation<Api extends ComponentApi>(
  api: Api,
  RenderComponent: React.FC<
    InkA2uiComponentProps<ResolveA2uiProps<InferredComponentApiSchemaType<Api>>>
  >,
): InkComponentImplementation {
  type Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;

  const MemoizedRender = memo(RenderComponent, (prev, next) => {
    if (prev.props !== next.props) return false;
    if (prev.context.componentModel.id !== next.context.componentModel.id) return false;
    if (prev.context.dataContext.path !== next.context.dataContext.path) return false;
    return true;
  });

  const InkWrapper: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }> = ({context, buildChild}) => {
    // DeferredChild memoizes `context`, so reference changes correspond to
    // ComponentModel updates or base-path adjustments. Cleanup disposes the
    // previous binder when this instance changes (or on unmount).
    const binding = useMemo(() => new GenericBinder<Props>(context, api.schema), [context]);

    const subscribe = useCallback(
      (callback: () => void) => {
        const sub = binding.subscribe(callback);
        return () => sub.unsubscribe();
      },
      [binding],
    );

    const getSnapshot = useCallback(() => binding.snapshot, [binding]);
    const props = useSyncExternalStore(subscribe, getSnapshot);

    useEffect(() => {
      return () => binding.dispose();
    }, [binding]);

    return (
      <MemoizedRender props={props || ({} as Props)} buildChild={buildChild} context={context} />
    );
  };

  return {
    name: api.name,
    schema: api.schema,
    render: InkWrapper,
  };
}
