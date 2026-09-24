/**
 * @license
 * Copyright 2024 Google LLC
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

import {ResponsePart} from '../../parser/response_part.js';
import {SchemaCatalog} from '../../types.js';
import {DirectJsonStreamProcessor, DirectJsonStreamProcessorOptions} from './streaming_types.js';
import {
  A2UI_OPEN_TAG,
  A2UI_CLOSE_TAG,
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
  DEFAULT_ROOT_ID,
} from '../../parser/constants.js';
import {
  buildComponentRefMap,
  ComponentRefMap,
  V10_CHILD_REF_OPTIONS,
  getComponentReferences,
  A2uiRecursionError,
} from '../../internal/web_core.js';
import {toWireProtocolVersion} from '../../utils/protocol_version.js';
import {A2uiIntegrityError, ParseError} from '../../errors.js';
import {
  isLegacyFallbackChildListKey,
  isLegacyFallbackSingleChildKey,
} from '../../utils/legacy_child_refs.js';

export class DirectJsonStreamProcessorImpl implements DirectJsonStreamProcessor {
  private buffer = '';
  private jsonBuffer = '';
  private braceStack: Array<[string, number]> = [];
  private braceCount = 0;
  private inTopLevelList = false;
  private inString = false;
  private stringEscaped = false;

  private foundDelimiter = false;
  private foundValidJsonInBlock = false;

  private componentsBySurface: Record<string, Record<string, Record<string, any>>> = {};
  private yieldedDataModel: Record<string, any> = {};
  private deletedSurfaces = new Set<string>();

  private yieldedIds: Record<string, Set<string>> = {};
  private yieldedContents: Record<string, string> = {};

  private rootIds: Record<string, string> = {};
  private unboundRootId: string | null = null;
  private surfaceId: string | null = null;
  private msgTypes: string[] = [];
  private activeMsgType: string | null = null;
  private yieldedStartMessages = new Set<string>();

  private pendingMessages: Record<string, any[]> = {};
  private bufferedStartMessage: any | null = null;
  private topologyDirty = false;

  private cuttableKeys: Set<string>;
  private refMap: ComponentRefMap;
  private requiredPropsCache = new Map<string, string[]>();

  constructor(
    private readonly catalog: SchemaCatalog,
    private readonly options?: DirectJsonStreamProcessorOptions,
  ) {
    this.cuttableKeys = new Set(options?.progressiveKeys ?? []);
    this.refMap = buildComponentRefMap(this.catalog, V10_CHILD_REF_OPTIONS);
    this.applyLegacyChildRefFallbacks();
  }

  /**
   * Applies Python a2ui_core-compatible fallback child reference heuristics ONLY when
   * a component's schema produced no formal references (singleRefs or listRefs).
   */
  private applyLegacyChildRefFallbacks() {
    if (!this.catalog.components || typeof this.catalog.components.values !== 'function') {
      return;
    }
    for (const compApi of this.catalog.components.values()) {
      const existing = this.refMap[compApi.name];
      // Gate: if the catalog produced any formal refs for this component type, use ONLY those.
      if (existing && (existing.singleRefs.size > 0 || existing.listRefs.size > 0)) {
        continue;
      }

      const singleRefs = new Set<string>(existing?.singleRefs ?? []);
      const listRefs = new Set<string>(existing?.listRefs ?? []);

      const schema = compApi.schema as unknown;
      if (
        schema &&
        typeof schema === 'object' &&
        'shape' in schema &&
        typeof (schema as {shape?: unknown}).shape === 'object' &&
        (schema as {shape?: unknown}).shape !== null
      ) {
        const shape = (schema as {shape: Record<string, unknown>}).shape;
        for (const key of Object.keys(shape)) {
          if (isLegacyFallbackChildListKey(key)) {
            listRefs.add(key);
          } else if (isLegacyFallbackSingleChildKey(key)) {
            singleRefs.add(key);
          }
        }
      }

      this.refMap[compApi.name] = {singleRefs, listRefs};
    }
  }

  private get placeholderComponent() {
    return {component: 'Row', children: []};
  }

  private get protocolVersion(): string {
    return toWireProtocolVersion(this.catalog.protocolVersion);
  }

  private get seenComponents() {
    const sid = this.surfaceId ?? 'default';
    if (!this.componentsBySurface[sid]) {
      this.componentsBySurface[sid] = {};
    }
    return this.componentsBySurface[sid];
  }

  private canUsePlaceholders(): boolean {
    const phType = this.placeholderComponent.component;
    return this.catalog.components.has(phType);
  }

  private getRootId(): string {
    if (this.surfaceId) {
      return this.rootIds[this.surfaceId] ?? DEFAULT_ROOT_ID;
    }
    return this.unboundRootId ?? DEFAULT_ROOT_ID;
  }

  private setRootId(value: string | null) {
    if (this.surfaceId) {
      if (value !== null) {
        this.rootIds[this.surfaceId] = value;
      } else {
        delete this.rootIds[this.surfaceId];
      }
    } else {
      this.unboundRootId = value;
    }
  }

  private addMsgType(msgType: string) {
    if (!this.msgTypes.includes(msgType)) {
      this.msgTypes.push(msgType);
    }
    if (msgType === MSG_TYPE_UPDATE_COMPONENTS || msgType === MSG_TYPE_CREATE_SURFACE) {
      this.activeMsgType = msgType;
    }
  }

  processChunk(chunk: string): ResponsePart[] {
    const messages: ResponsePart[] = [];
    this.buffer += chunk;

    while (true) {
      if (!this.foundDelimiter) {
        const openIdx = this.buffer.indexOf(A2UI_OPEN_TAG);
        if (openIdx !== -1) {
          const textBefore = this.buffer.substring(0, openIdx);
          if (textBefore) {
            messages.push({type: 'text', text: textBefore});
          }
          this.foundDelimiter = true;
          this.buffer = this.buffer.substring(openIdx + A2UI_OPEN_TAG.length);
        } else {
          let keepLen = 0;
          for (let i = A2UI_OPEN_TAG.length - 1; i > 0; i--) {
            if (this.buffer.endsWith(A2UI_OPEN_TAG.substring(0, i))) {
              keepLen = i;
              break;
            }
          }
          if (this.buffer.length > keepLen) {
            const safeLen = this.buffer.length - keepLen;
            const textToYield = this.buffer.substring(0, safeLen);
            messages.push({type: 'text', text: textToYield});
            this.buffer = this.buffer.substring(safeLen);
          }
          break;
        }
      }

      if (this.foundDelimiter) {
        const closeIdx = this.buffer.indexOf(A2UI_CLOSE_TAG);
        if (closeIdx !== -1) {
          const jsonFragment = this.buffer.substring(0, closeIdx);
          this.processJsonChunk(jsonFragment, messages);

          if (!this.foundValidJsonInBlock) {
            throw new ParseError('Failed to parse JSON: No valid JSON object found in A2UI block.');
          }

          this.foundDelimiter = false;
          this.resetJsonState();
          this.buffer = this.buffer.substring(closeIdx + A2UI_CLOSE_TAG.length);
        } else {
          let keepLen = 0;
          for (let i = 1; i < A2UI_CLOSE_TAG.length; i++) {
            if (this.buffer.endsWith(A2UI_CLOSE_TAG.substring(0, i))) {
              keepLen = i;
            }
          }
          if (keepLen < this.buffer.length) {
            const toProcess = this.buffer.substring(0, this.buffer.length - keepLen);
            this.buffer = this.buffer.substring(this.buffer.length - keepLen);
            this.processJsonChunk(toProcess, messages);
          }
          break;
        }
      }
    }

    // Deduplicate trailing updateComponents
    for (const part of messages) {
      if (part.type === 'a2ui' && Array.isArray(part.a2ui)) {
        const deduped: any[] = [];
        const seenSu = new Set<string>();
        for (let i = part.a2ui.length - 1; i >= 0; i--) {
          const m = part.a2ui[i];
          if (m && typeof m === 'object' && MSG_TYPE_UPDATE_COMPONENTS in m) {
            const payload = (m as Record<string, any>)[MSG_TYPE_UPDATE_COMPONENTS];
            const sid = payload?.surfaceId;
            if (sid) {
              if (!seenSu.has(sid)) {
                deduped.push(m);
                seenSu.add(sid);
              }
            } else {
              deduped.push(m);
            }
          } else {
            deduped.push(m);
          }
        }
        part.a2ui = deduped.reverse();
      }
    }

    return messages;
  }

  private resetJsonState() {
    this.jsonBuffer = '';
    this.braceStack = [];
    this.braceCount = 0;
    this.inTopLevelList = false;
    this.inString = false;
    this.stringEscaped = false;
    this.msgTypes = [];
    this.foundValidJsonInBlock = false;
    this.activeMsgType = null;
    this.foundDelimiter = false;
  }

  private fixJson(fragment: string): string {
    let fixed = fragment.trimEnd();
    if (!fixed) return '';

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let lastQuoteIdx = -1;

    for (let i = 0; i < fixed.length; i++) {
      const char = fixed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        if (inString) lastQuoteIdx = i;
      } else if (!inString) {
        if (char === '{' || char === '[') {
          stack.push(char);
        } else if (char === '}' || char === ']') {
          if (stack.length > 0) stack.pop();
        }
      }
    }

    if (inString) {
      const prefix = fixed.substring(0, lastQuoteIdx).trimEnd();
      if (prefix.endsWith(':')) {
        const keyMatch = /"([^"]+)"\s*:\s*$/.exec(prefix);
        if (keyMatch) {
          const key = keyMatch[1];
          if (!this.cuttableKeys.has(key)) return '';

          if (key === 'valueString') {
            const stringVal = fixed.substring(lastQuoteIdx + 1);
            if (
              stringVal.startsWith('http://') ||
              stringVal.startsWith('https://') ||
              stringVal.startsWith('data:') ||
              stringVal.startsWith('/')
            ) {
              return '';
            }

            const prefixLast200 = prefix.slice(-200);
            const prevKeyMatches = [...prefixLast200.matchAll(/"key"\s*:\s*"([^"]+)"/g)];
            if (prevKeyMatches.length > 0) {
              const dataKey = prevKeyMatches[prevKeyMatches.length - 1][1].toLowerCase();
              const hints = ['url', 'link', 'src', 'href', 'image'];
              if (hints.some(h => dataKey.includes(h))) {
                return '';
              }
            }
          }
        }
      }
      fixed += '"';
    }

    fixed = fixed.trimEnd();
    if (fixed.endsWith(',')) {
      fixed = fixed.slice(0, -1).trimEnd();
    }

    while (stack.length > 0) {
      const opening = stack.pop();
      fixed += opening === '{' ? '}' : ']';
    }

    return fixed;
  }

  private processJsonChunk(chunk: string, messages: ResponsePart[]) {
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      let charHandled = false;

      if (this.braceCount === 0) {
        if (char === '[') {
          this.inTopLevelList = true;
        } else if (char === '{') {
          // pass
        } else {
          continue;
        }
      }

      if (!charHandled && this.inString) {
        if (this.stringEscaped) {
          this.stringEscaped = false;
          if (this.braceCount > 0) this.jsonBuffer += char;
        } else if (char === '\\') {
          this.stringEscaped = true;
          if (this.braceCount > 0) this.jsonBuffer += char;
        } else if (char === '"') {
          this.inString = false;
          if (this.braceCount > 0) this.jsonBuffer += char;
        } else {
          if (this.braceCount > 0) this.jsonBuffer += char;
        }
        charHandled = true;
      }

      if (!charHandled) {
        if (char === '"') {
          this.inString = true;
          this.stringEscaped = false;
          if (this.braceCount > 0) this.jsonBuffer += char;
        } else if (char === '{') {
          if (this.braceCount === 0) this.msgTypes = [];
          this.braceStack.push(['{', this.jsonBuffer.length]);
          this.jsonBuffer += '{';
          this.braceCount++;
        } else if (char === '}') {
          if (this.braceStack.length > 0) {
            const popped = this.braceStack.pop()!;
            const startIdx = popped[1];
            this.jsonBuffer += '}';
            this.braceCount--;

            if (this.braceCount >= 0) {
              const objBuffer = this.jsonBuffer.substring(startIdx);
              if (objBuffer.startsWith('{') && objBuffer.endsWith('}')) {
                try {
                  const obj = JSON.parse(objBuffer);
                  if (typeof obj === 'object' && obj !== null) {
                    this.foundValidJsonInBlock = true;

                    const isProtocol = this.inTopLevelList && this.isProtocolMsg(obj);
                    const isComp = !!(obj.id && obj.component);
                    const isTopLevel =
                      this.braceStack.length === 0 ||
                      (this.inTopLevelList &&
                        this.braceStack.length === 1 &&
                        this.braceStack[0][0] === '[');

                    if (isComp) {
                      this.handlePartialComponent(obj);
                    } else if (isTopLevel || isProtocol) {
                      if (!this.handleCompleteObject(obj, this.surfaceId, messages)) {
                        this.yieldMessages([obj], messages);
                      }
                    }

                    if (
                      this.braceCount === 0 ||
                      (this.inTopLevelList && this.braceStack.length === 1)
                    ) {
                      if (this.braceStack.length === 1 && this.braceStack[0][0] === '[') {
                        this.jsonBuffer =
                          this.jsonBuffer.substring(0, startIdx) +
                          this.jsonBuffer.substring(startIdx + objBuffer.length);
                      } else {
                        this.jsonBuffer = this.jsonBuffer.substring(objBuffer.length);
                        if (this.braceStack.length > 0) {
                          const shift = objBuffer.length;
                          this.braceStack = this.braceStack.map(([bType, idx]) => [
                            bType,
                            idx - shift,
                          ]);
                        }
                      }
                    }
                  }
                } catch (e) {
                  if (!(e instanceof SyntaxError)) {
                    throw e;
                  }
                }
              }
            }
          }
        } else if (char === '[') {
          this.braceStack.push(['[', this.jsonBuffer.length]);
          this.jsonBuffer += '[';
          this.braceCount++;
        } else if (char === ']') {
          if (
            this.braceStack.length > 0 &&
            this.braceStack[this.braceStack.length - 1][0] === '['
          ) {
            this.braceStack.pop();
            this.jsonBuffer += ']';
            this.braceCount--;
            if (this.braceCount === 0) {
              this.inTopLevelList = false;
            }
          }
        } else {
          if (this.braceCount > 0) this.jsonBuffer += char;
        }
      }

      if (
        this.braceCount > 0 &&
        (char === '"' || char === ':' || char === ',' || char === '}' || char === ']')
      ) {
        this.sniffMetadata();
      }
    }

    if (this.braceCount >= 1 && this.jsonBuffer) {
      this.sniffPartialComponent();
      this.sniffPartialDataModel(messages);
    }

    if (this.topologyDirty) {
      this.yieldReachable(messages, false, false);
      this.topologyDirty = false;
    }
  }

  private isProtocolMsg(obj: Record<string, any>): boolean {
    return (
      MSG_TYPE_CREATE_SURFACE in obj ||
      MSG_TYPE_UPDATE_COMPONENTS in obj ||
      MSG_TYPE_UPDATE_DATA_MODEL in obj ||
      MSG_TYPE_DELETE_SURFACE in obj
    );
  }

  private sniffMetadata() {
    const jsonStr = this.jsonBuffer;
    if (!jsonStr) return;

    if (this.msgTypes.length === 0) {
      for (const mt of [
        MSG_TYPE_UPDATE_COMPONENTS,
        MSG_TYPE_CREATE_SURFACE,
        MSG_TYPE_DELETE_SURFACE,
        MSG_TYPE_UPDATE_DATA_MODEL,
      ]) {
        if (jsonStr.includes(`"${mt}"`)) {
          this.addMsgType(mt);
        }
      }
    }

    const surfaceIdMatches = [...jsonStr.matchAll(/"surfaceId"\s*:\s*"([^"]+)"/g)];
    if (surfaceIdMatches.length > 0) {
      this.surfaceId = surfaceIdMatches[surfaceIdMatches.length - 1][1];
    }

    const rootMatches = [...jsonStr.matchAll(/"root"\s*:\s*"([^"]+)"/g)];
    if (rootMatches.length > 0) {
      this.setRootId(rootMatches[rootMatches.length - 1][1]);
    }
  }

  private hasEmptyDict(obj: any): boolean {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.some(v => this.hasEmptyDict(v));
      } else {
        const keys = Object.keys(obj);
        if (keys.length === 0) return true;
        return keys.some(k => this.hasEmptyDict(obj[k]));
      }
    }
    return false;
  }

  /**
   * Returns the properties the catalog marks as required for a component type.
   *
   * Mirrors Python's `SchemaHelper.get_component_required`, which reads the `required` array
   * straight out of the component's JSON Schema. No JSON Schema survives into this SDK at
   * runtime, but web_core's loader translates `required` faithfully into non-optional zod
   * fields, so a property is required exactly when its field is not optional.
   *
   * A component type the catalog does not know, or a schema whose shape cannot be read, is
   * reported as having no required properties. That is deliberately the permissive
   * direction: an unreadable schema should not silently withhold every component on the
   * wire. The same applies to a shape entry that does not expose `isOptional`.
   */
  private getRequiredProps(componentType: string): string[] {
    const cached = this.requiredPropsCache.get(componentType);
    if (cached !== undefined) {
      return cached;
    }

    const componentApi = this.catalog.components.get(componentType);
    if (!componentApi || !componentApi.schema) {
      this.requiredPropsCache.set(componentType, []);
      return [];
    }

    const schema = componentApi.schema;
    if (typeof schema === 'object' && schema !== null && 'shape' in schema) {
      interface ZodObjectShapeLike {
        shape: Record<string, {isOptional?: () => boolean}>;
      }
      const shapeObj = (schema as unknown as ZodObjectShapeLike).shape;
      if (typeof shapeObj === 'object' && shapeObj !== null) {
        const required: string[] = [];
        for (const [key, field] of Object.entries(shapeObj)) {
          if (typeof field?.isOptional === 'function') {
            if (!field.isOptional()) {
              required.push(key);
            }
          }
        }
        this.requiredPropsCache.set(componentType, required);
        return required;
      }
    }

    this.requiredPropsCache.set(componentType, []);
    return [];
  }

  private handlePartialComponent(comp: Record<string, any>) {
    const compId = comp.id as string | undefined;
    if (!compId) return;

    if (this.hasEmptyDict(comp)) return;

    const compType = comp.component;
    if (typeof compType === 'string') {
      const required = this.getRequiredProps(compType);
      for (const req of required) {
        if (!(req in comp)) {
          return;
        }
      }
    }

    this.seenComponents[compId] = comp;
    this.topologyDirty = true;
  }

  private sniffPartialComponent() {
    if (!this.jsonBuffer.includes('"components"')) return;

    for (let i = this.braceStack.length - 1; i >= 0; i--) {
      const [bType, startIdx] = this.braceStack[i];
      if (bType !== '{') continue;
      const rawFrag = this.jsonBuffer.substring(startIdx);
      if (!rawFrag) continue;

      const fixed = this.fixJson(rawFrag);
      try {
        const obj = JSON.parse(fixed);
        if (typeof obj === 'object' && obj !== null && obj.id && obj.component) {
          if (typeof obj.component === 'string') {
            this.handlePartialComponent(obj);
          }
        }
      } catch (_e) {
        continue;
      }
    }
  }

  private sniffPartialDataModel(messages: ResponsePart[]) {
    const msgType = MSG_TYPE_UPDATE_DATA_MODEL;
    if (!this.jsonBuffer.includes(`"${msgType}"`)) return;

    for (let i = this.braceStack.length - 1; i >= 0; i--) {
      const [bType, startIdx] = this.braceStack[i];
      if (bType !== '{') continue;
      const rawFrag = this.jsonBuffer.substring(startIdx);
      if (!rawFrag) continue;

      const fixed = this.fixJson(rawFrag);
      let obj: any = null;
      try {
        obj = JSON.parse(fixed);
      } catch (_e) {
        let trimmed = rawFrag;
        while (trimmed.includes(',')) {
          trimmed = trimmed.substring(0, trimmed.lastIndexOf(','));
          try {
            const fixedTrimmed = this.fixJson(trimmed);
            if (fixedTrimmed) {
              obj = JSON.parse(fixedTrimmed);
              break;
            }
          } catch (_e2) {
            continue;
          }
        }
      }

      if (obj && typeof obj === 'object' && msgType in obj) {
        const dmObj = obj[msgType];
        if (typeof dmObj === 'object' && dmObj !== null && 'value' in dmObj) {
          const valueMap = dmObj.value;
          if (typeof valueMap === 'object' && valueMap !== null) {
            const delta: Record<string, any> = {};
            for (const [k, v] of Object.entries(valueMap)) {
              if (this.yieldedDataModel[k] !== v) {
                delta[k] = v;
              }
            }

            if (Object.keys(delta).length > 0) {
              const sid = dmObj.surfaceId ?? this.surfaceId ?? 'default';
              const deltaMsg = {
                version: this.protocolVersion,
                [msgType]: {
                  surfaceId: sid,
                  value: delta,
                },
              };
              this.yieldMessages([deltaMsg], messages);
              Object.assign(this.yieldedDataModel, delta);
            }
          }
        }
      }
    }
  }

  private handleCompleteObject(
    obj: Record<string, any>,
    sid: string | null,
    messages: ResponsePart[],
  ): boolean {
    if (MSG_TYPE_CREATE_SURFACE in obj) {
      this.addMsgType(MSG_TYPE_CREATE_SURFACE);
      const val = obj[MSG_TYPE_CREATE_SURFACE];
      sid = val?.surfaceId ?? sid;
      this.surfaceId = sid;

      if (typeof val === 'object' && val !== null) {
        this.setRootId(val.root ?? this.getRootId());
        if (Array.isArray(val.components)) {
          const seen = this.seenComponents;
          for (const c of val.components) {
            if (c && typeof c === 'object' && c.id) {
              seen[c.id] = c;
              if (!this.yieldedIds[sid!]) this.yieldedIds[sid!] = new Set();
              this.yieldedIds[sid!].add(c.id);
              this.yieldedContents[`${sid}_${c.id}`] = this.stableStringify(c);
            }
          }
        }
      }
      this.bufferedStartMessage = obj;

      if (sid && !this.yieldedStartMessages.has(sid)) {
        this.yieldMessages([obj], messages);
        this.yieldedStartMessages.add(sid);
        this.bufferedStartMessage = null;
      }

      if (sid && this.pendingMessages[sid]) {
        delete this.pendingMessages[sid];
      }

      this.yieldReachable(messages, false, false);
      return true;
    }

    if (MSG_TYPE_UPDATE_COMPONENTS in obj) {
      this.addMsgType(MSG_TYPE_UPDATE_COMPONENTS);
      const val = obj[MSG_TYPE_UPDATE_COMPONENTS];
      if (val && typeof val === 'object' && val.surfaceId) {
        sid = val.surfaceId;
        this.surfaceId = sid;
      }
      this.setRootId(val?.root ?? this.getRootId());
      if (val && Array.isArray(val.components)) {
        for (const c of val.components) {
          if (c && typeof c === 'object' && c.id) {
            this.seenComponents[c.id] = c;
          }
        }
      }
      this.yieldReachable(messages, true, false);
      return true;
    }

    if (MSG_TYPE_DELETE_SURFACE in obj) {
      const val = obj[MSG_TYPE_DELETE_SURFACE];
      const targetSid = val?.surfaceId ?? sid;
      if (targetSid && !this.yieldedStartMessages.has(targetSid)) {
        if (!this.pendingMessages[targetSid]) this.pendingMessages[targetSid] = [];
        this.pendingMessages[targetSid].push(obj);
        return true;
      }
      this.addMsgType(MSG_TYPE_DELETE_SURFACE);
      this.yieldMessages([obj], messages);
      if (targetSid) {
        delete this.pendingMessages[targetSid];
        delete this.yieldedIds[targetSid];
        delete this.componentsBySurface[targetSid];
        for (const k of Object.keys(this.yieldedContents)) {
          if (k.startsWith(`${targetSid}_`)) {
            delete this.yieldedContents[k];
          }
        }
        this.yieldedStartMessages.delete(targetSid);
        this.deletedSurfaces.add(targetSid);
      }
      return true;
    }

    if (MSG_TYPE_UPDATE_DATA_MODEL in obj) {
      this.addMsgType(MSG_TYPE_UPDATE_DATA_MODEL);
      const udm = obj[MSG_TYPE_UPDATE_DATA_MODEL];
      if (udm && typeof udm === 'object' && udm.surfaceId) {
        sid = udm.surfaceId;
        this.surfaceId = sid;
      }
      if (typeof udm === 'object' && udm !== null && 'value' in udm) {
        const val = udm.value;
        if (typeof val === 'object' && val !== null) {
          let isNew = false;
          for (const [k, v] of Object.entries(val)) {
            if (this.yieldedDataModel[k] !== v) {
              isNew = true;
              break;
            }
          }
          if (!isNew) return true;
          for (const [k, v] of Object.entries(val)) {
            this.yieldedDataModel[k] = v;
          }
        }
      }
      this.yieldMessages([obj], messages);
      return true;
    }

    return false;
  }

  private yieldMessages(msgs: any[], outParts: ResponsePart[]) {
    for (const m of msgs) {
      if (outParts.length > 0) {
        const last = outParts[outParts.length - 1];
        if (last.type === 'a2ui' && Array.isArray(last.a2ui)) {
          last.a2ui.push(m);
          continue;
        } else if (last.type === 'text') {
          outParts.push({type: 'a2ui', a2ui: [m]});
          continue;
        }
      }
      outParts.push({type: 'a2ui', a2ui: [m]});
    }
  }

  private getActiveMsgTypeForComponents(): string | null {
    if (this.activeMsgType) return this.activeMsgType;
    for (const mt of this.msgTypes) {
      if (mt === MSG_TYPE_UPDATE_COMPONENTS || mt === MSG_TYPE_CREATE_SURFACE) {
        this.activeMsgType = mt;
        return mt;
      }
    }
    return this.msgTypes[0] ?? null;
  }

  private getPlaceholderId(childId: string): string {
    return `loading_${childId}`;
  }

  private processComponentTopology(comp: Record<string, any>, extra: Record<string, any>[]) {
    const compId = comp.id ?? 'unknown';
    this.traverseComponentTopology(comp, extra, compId);
  }

  private traverseComponentTopology(obj: any, extra: Record<string, any>[], compId: string) {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        for (const item of obj) {
          this.traverseComponentTopology(item, extra, compId);
        }
      } else {
        const compType = obj.component as string | undefined;
        if (compType && this.refMap[compType]) {
          const refs = this.refMap[compType];

          const processPointers = (val: any, fieldKey: string): any => {
            if (typeof val === 'string') {
              if (this.seenComponents[val]) return val;
              if (this.canUsePlaceholders()) {
                const phId = this.getPlaceholderId(val);
                if (!extra.some(e => e.id === phId)) {
                  extra.push({id: phId, ...this.placeholderComponent});
                }
                return phId;
              }
              return val;
            } else if (Array.isArray(val)) {
              const newArr: any[] = [];
              for (const item of val) {
                if (typeof item === 'string') {
                  const newItem = processPointers(item, fieldKey);
                  newArr.push(newItem);
                } else if (typeof item === 'object' && item !== null) {
                  newArr.push(processPointers(item, fieldKey));
                }
              }
              if (newArr.length === 0) {
                const term = `"${fieldKey}"`;
                if (this.jsonBuffer.includes(term) && this.canUsePlaceholders()) {
                  const after = this.jsonBuffer.substring(
                    this.jsonBuffer.indexOf(term) + term.length,
                  );
                  if (
                    after.includes('[') &&
                    !after.substring(0, after.indexOf('[')).includes(']')
                  ) {
                    const phId = `loading_children_${compId}`;
                    newArr.push(phId);
                    if (!extra.some(e => e.id === phId)) {
                      extra.push({id: phId, ...this.placeholderComponent});
                    }
                  }
                }
              }
              return newArr;
            } else if (typeof val === 'object' && val !== null) {
              if ('componentId' in val && typeof val.componentId === 'string') {
                const cid = val.componentId;
                if (!this.seenComponents[cid] && this.canUsePlaceholders()) {
                  const phId = this.getPlaceholderId(cid);
                  val.componentId = phId;
                  if (!extra.some(e => e.id === phId)) {
                    extra.push({id: phId, ...this.placeholderComponent});
                  }
                }
              } else {
                for (const k of Object.keys(val)) {
                  val[k] = processPointers(val[k], k);
                }
              }
              return val;
            }
            return val;
          };

          for (const field of refs.listRefs) {
            if (obj[field] !== undefined) {
              obj[field] = processPointers(obj[field], field);
            }
          }
          for (const field of refs.singleRefs) {
            if (obj[field] !== undefined) {
              obj[field] = processPointers(obj[field], field);
            }
          }
        }

        for (const [, v] of Object.entries(obj)) {
          this.traverseComponentTopology(v, extra, compId);
        }
      }
    }
  }

  private stableStringify(obj: any): string {
    if (Array.isArray(obj)) {
      return `[${obj.map(o => this.stableStringify(o)).join(',')}]`;
    }
    if (typeof obj === 'object' && obj !== null) {
      const keys = Object.keys(obj).sort();
      return `{${keys.map(k => `"${k}":${this.stableStringify(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(obj);
  }

  private yieldReachable(messages: ResponsePart[], checkRoot: boolean, raiseOnOrphans: boolean) {
    const activeMsgType = this.getActiveMsgTypeForComponents();
    if (!this.getRootId() || !activeMsgType) return;
    if (!this.surfaceId) return;

    const sid = this.surfaceId;
    if (!this.yieldedStartMessages.has(sid) && !this.bufferedStartMessage) return;

    try {
      const root = this.getRootId();
      if (checkRoot && !this.seenComponents[root]) {
        throw new A2uiIntegrityError(`No root component (id='${root}') found in ${activeMsgType}`);
      }

      let availableReachable = new Set<string>();
      if (this.seenComponents[root]) {
        const collect = (nodeId: string, pathSeen: Set<string>, targetSet: Set<string>) => {
          if (pathSeen.has(nodeId)) {
            throw new A2uiRecursionError('Circular reference detected');
          }
          if (targetSet.has(nodeId)) return;
          if (nodeId && this.seenComponents[nodeId]) {
            pathSeen.add(nodeId);
            targetSet.add(nodeId);
            const compObj = this.seenComponents[nodeId];
            for (const [childId, fieldName] of getComponentReferences(compObj, this.refMap)) {
              if (childId === nodeId) {
                throw new A2uiRecursionError(
                  `Circular reference detected: Component '${nodeId}' references itself in field '${fieldName}' (Self-reference detected)`,
                );
              }
              if (this.seenComponents[childId]) {
                collect(childId, new Set(pathSeen), targetSet);
              }
            }
          }
        };
        try {
          collect(root, new Set(), availableReachable);
        } catch (e) {
          if (e instanceof A2uiRecursionError) {
            throw e;
          }
        }
      }

      if (!this.canUsePlaceholders()) {
        const isCompleteSubtree = (nodeId: string, pathSeen: Set<string>): boolean => {
          if (!this.seenComponents[nodeId] || pathSeen.has(nodeId)) return false;
          pathSeen.add(nodeId);
          const compObj = this.seenComponents[nodeId];
          const compType = compObj.component as string | undefined;
          if (compType && this.refMap[compType]) {
            const refs = this.refMap[compType];
            for (const field of refs.listRefs) {
              const vals = compObj[field];
              if (Array.isArray(vals)) {
                for (const v of vals) {
                  if (typeof v === 'string') {
                    if (!isCompleteSubtree(v, new Set(pathSeen))) return false;
                  } else if (typeof v === 'object' && v !== null) {
                    const vObj = v as Record<string, unknown>;
                    if ('componentId' in vObj) {
                      const cid = vObj.componentId;
                      const path = vObj.path;
                      if (typeof cid !== 'string' || !cid || typeof path !== 'string' || !path) {
                        return false;
                      }
                      if (!isCompleteSubtree(cid, new Set(pathSeen))) return false;
                    }
                  }
                }
              } else if (typeof vals === 'object' && vals !== null) {
                const valsObj = vals as Record<string, unknown>;
                if ('componentId' in valsObj) {
                  const cid = valsObj.componentId;
                  const path = valsObj.path;
                  if (typeof cid !== 'string' || !cid || typeof path !== 'string' || !path) {
                    return false;
                  }
                  if (!isCompleteSubtree(cid, new Set(pathSeen))) return false;
                } else {
                  return false;
                }
              }
            }
            for (const field of refs.singleRefs) {
              const v = compObj[field];
              if (typeof v === 'string') {
                if (!isCompleteSubtree(v, new Set(pathSeen))) return false;
              } else if (typeof v === 'object' && v !== null) {
                const vObj = v as Record<string, unknown>;
                if ('componentId' in vObj) {
                  const cid = vObj.componentId;
                  if (
                    typeof cid !== 'string' ||
                    !cid ||
                    !isCompleteSubtree(cid, new Set(pathSeen))
                  ) {
                    return false;
                  }
                } else if ('child' in vObj) {
                  const cid = vObj.child;
                  if (
                    typeof cid !== 'string' ||
                    !cid ||
                    !isCompleteSubtree(cid, new Set(pathSeen))
                  ) {
                    return false;
                  }
                }
              }
            }
          }
          return true;
        };

        const completeNodes = new Set<string>();
        if (this.seenComponents[root] && isCompleteSubtree(root, new Set())) {
          const collectTree = (nodeId: string, collected: Set<string>) => {
            if (collected.has(nodeId)) return;
            collected.add(nodeId);
            const compObj = this.seenComponents[nodeId];
            const compType = compObj.component as string | undefined;
            if (compType && this.refMap[compType]) {
              const refs = this.refMap[compType];
              for (const field of refs.listRefs) {
                const vals = compObj[field];
                if (Array.isArray(vals)) {
                  for (const v of vals) {
                    if (typeof v === 'string') {
                      collectTree(v, collected);
                    } else if (
                      typeof v === 'object' &&
                      v !== null &&
                      'componentId' in v &&
                      typeof (v as Record<string, unknown>).componentId === 'string'
                    ) {
                      collectTree((v as Record<string, unknown>).componentId as string, collected);
                    }
                  }
                } else if (
                  typeof vals === 'object' &&
                  vals !== null &&
                  'componentId' in vals &&
                  typeof (vals as Record<string, unknown>).componentId === 'string'
                ) {
                  collectTree((vals as Record<string, unknown>).componentId as string, collected);
                }
              }
              for (const field of refs.singleRefs) {
                const v = compObj[field];
                if (typeof v === 'string') {
                  collectTree(v, collected);
                } else if (typeof v === 'object' && v !== null) {
                  const vObj = v as Record<string, unknown>;
                  if (typeof vObj.componentId === 'string') {
                    collectTree(vObj.componentId, collected);
                  } else if (typeof vObj.child === 'string') {
                    collectTree(vObj.child, collected);
                  }
                }
              }
            }
          };
          collectTree(root, completeNodes);
        }
        availableReachable = completeNodes;
      }

      const processedComponents: Record<string, any>[] = [];
      const extraComponents: Record<string, any>[] = [];

      for (const rid of Array.from(availableReachable).sort()) {
        const comp = JSON.parse(JSON.stringify(this.seenComponents[rid]));
        this.processComponentTopology(comp, extraComponents);
        processedComponents.push(comp);
      }
      processedComponents.push(...extraComponents);

      if (this.deletedSurfaces.has(sid)) return;

      let shouldYield = false;
      const yieldedForSurface = this.yieldedIds[sid] ?? new Set();

      for (const rid of availableReachable) {
        if (!yieldedForSurface.has(rid)) {
          shouldYield = true;
          break;
        }
      }

      if (!shouldYield) {
        for (const comp of processedComponents) {
          const cid = comp.id;
          const contentStr = this.stableStringify(comp);
          if (this.yieldedContents[`${sid}_${cid}`] !== contentStr) {
            shouldYield = true;
            break;
          }
        }
      }

      if (shouldYield) {
        if (this.bufferedStartMessage && !this.yieldedStartMessages.has(sid)) {
          this.yieldMessages([this.bufferedStartMessage], messages);
          this.yieldedStartMessages.add(sid);
        }

        const partialMsg = {
          version: this.protocolVersion,
          [MSG_TYPE_UPDATE_COMPONENTS]: {
            surfaceId: sid,
            components: processedComponents,
          },
        };

        this.yieldMessages([partialMsg], messages);
        if (!this.yieldedIds[sid]) this.yieldedIds[sid] = new Set();
        for (const rid of availableReachable) {
          this.yieldedIds[sid].add(rid);
        }

        for (const comp of processedComponents) {
          this.yieldedContents[`${sid}_${comp.id}`] = this.stableStringify(comp);
        }
      }
    } catch (e: any) {
      const msg = e.message || '';
      if (raiseOnOrphans || msg.includes('Circular') || checkRoot) {
        throw e;
      }
    }
  }
}
