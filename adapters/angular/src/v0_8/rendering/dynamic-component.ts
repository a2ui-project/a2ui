/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Directive, inject, input} from '@angular/core';
import {MessageProcessor} from '../data';
import {Theme} from './theming';
import type {
  A2UIClientEventMessage,
  Action,
  AnyComponentNode,
  BooleanValue,
  NumberValue,
  ServerToClientMessage,
  StringValue,
  SurfaceID,
} from '../types';

let idCounter = 0;

@Directive({
  host: {
    '[style.--weight]': 'weight()',
  },
})
export abstract class DynamicComponent<T extends AnyComponentNode = AnyComponentNode> {
  protected readonly processor = inject(MessageProcessor);
  protected readonly theme = inject(Theme);

  readonly surfaceId = input.required<SurfaceID | null>();
  readonly component = input.required<T>();
  readonly weight = input.required<string | number>();

  protected sendAction(action: Action): Promise<ServerToClientMessage[]> {
    const component = this.component();
    const surfaceId = this.surfaceId() ?? undefined;
    const context: Record<string, unknown> = {};

    if (action.context) {
      for (const item of action.context) {
        if (item.value.literalBoolean !== undefined) {
          context[item.key] = item.value.literalBoolean;
        } else if (item.value.literalNumber !== undefined) {
          context[item.key] = item.value.literalNumber;
        } else if (item.value.literalString !== undefined) {
          context[item.key] = item.value.literalString;
        } else if (item.value.path) {
          const path = this.processor.resolvePath(item.value.path, component.dataContextPath);
          const value = this.processor.getData(component, path, surfaceId);
          context[item.key] = value;
        }
      }
    }

    const message: A2UIClientEventMessage = {
      userAction: {
        name: action.name,
        sourceComponentId: component.id,
        surfaceId: surfaceId!,
        timestamp: new Date().toISOString(),
        context,
      },
    };

    return this.processor.dispatch(message);
  }

  protected resolvePrimitive(value: StringValue | null): string | null;
  protected resolvePrimitive(value: BooleanValue | null): boolean | null;
  protected resolvePrimitive(value: NumberValue | null): number | null;
  protected resolvePrimitive(value: StringValue | BooleanValue | NumberValue | null) {
    const component = this.component();
    const surfaceId = this.surfaceId();

    if (!value || typeof value !== 'object') {
      return null;
    } else if ('literal' in value && value.literal != null) {
      return value.literal;
    } else if (value.path) {
      return this.processor.getData(component, value.path, surfaceId ?? undefined) as any;
    } else if ('literalString' in value) {
      return value.literalString;
    } else if ('literalNumber' in value) {
      return value.literalNumber;
    } else if ('literalBoolean' in value) {
      return value.literalBoolean;
    }

    return null;
  }

  protected getUniqueId(prefix: string) {
    return `${prefix}-${idCounter++}`;
  }
}
