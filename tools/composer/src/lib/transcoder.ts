/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
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

/**
 * Transpile A2UI messages to v0.8 format that the React renderer understands.
 *
 * v0.8 messages (beginRendering, surfaceUpdate, dataModelUpdate) pass through as-is.
 * v0.9 messages (createSurface, updateComponents, updateDataModel) get converted.
 */
export function transpileToV0_8(msg: any): any {
  // v0.9 -> v0.8 conversions
  if (msg.createSurface) {
    return {
      beginRendering: {
        surfaceId: msg.createSurface.surfaceId,
        root: msg.createSurface.root || 'root',
        styles: msg.createSurface.styles || {},
      },
    };
  }
  if (msg.updateComponents) {
    // Convert v0.9 type/props format to v0.8 component format
    const components = (msg.updateComponents.components || []).map((comp: any) => {
      if (comp.component) {
        // Already v0.8 format
        return comp;
      }
      if (comp.type) {
        // v0.9 format: convert type/props to v0.8 component map
        const props = comp.props || {};
        const v08Props: Record<string, any> = {};

        for (const [key, value] of Object.entries(props)) {
          if (key === 'children' && Array.isArray(value)) {
            // v0.9 children: ["id1", "id2"] -> v0.8 children: { explicitList: ["id1", "id2"] }
            v08Props.children = {explicitList: value};
          } else if (key === 'variant') {
            // v0.9 variant -> v0.8 usageHint
            v08Props.usageHint = value;
          } else if (key === 'text' && typeof value === 'string') {
            // v0.9 text: "Hello" -> v0.8 text: { stringValue: "Hello" }
            v08Props.text = {stringValue: value};
          } else if (key === 'url' && typeof value === 'string') {
            v08Props.url = {stringValue: value};
          } else if (key === 'label' && typeof value === 'string') {
            v08Props.label = {stringValue: value};
          } else if (key === 'child' && typeof value === 'string') {
            // Single child ref
            v08Props.child = value;
          } else {
            v08Props[key] = value;
          }
        }

        return {
          id: comp.id,
          component: {[comp.type]: v08Props},
        };
      }
      return comp;
    });

    return {
      surfaceUpdate: {
        surfaceId: msg.updateComponents.surfaceId,
        components,
      },
    };
  }
  if (msg.updateDataModel) {
    return {
      dataModelUpdate: {
        surfaceId: msg.updateDataModel.surfaceId,
        path: msg.updateDataModel.path || '/',
        contents: msg.updateDataModel.contents,
      },
    };
  }
  if (msg.deleteSurface) {
    return {
      deleteSurface: {
        surfaceId: msg.deleteSurface.surfaceId,
      },
    };
  }

  // v0.8 messages pass through as-is
  return msg;
}
