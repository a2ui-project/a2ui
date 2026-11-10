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

export interface FeedItem {
  id: string;
  type: 'user' | 'assistant';
  text?: string;
  surfaceId?: string;
  raw?: string;
  messages?: any[];
  metrics?: {
    latency?: number;
    thinkingTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
    isPreset?: boolean;
  };
}

export interface MacroDefinition {
  version?: string;
  name?: string;
  macroId?: string;
  templateId: string;
  parameters: Record<string, any>;
  components?: any[];
  layout?: Record<string, any>;
  yamlContent?: string;
  pythonCode?: string;
  description?: string;
  sampleData?: Record<string, any>;
  sampleMessages?: any[];
  isDynamic?: boolean;
  isProgrammatic?: boolean;
  isDataBinding?: boolean;
  renderSource?: string;
  layoutTemplate?: Record<string, any>;
  layoutTemplateYaml?: string;
  layoutTemplatePython?: string;
  resolvedData?: Record<string, any>;
  availablePresets?: Array<{label: string; value: string}>;
}

export type TemplateDefinition = MacroDefinition;
