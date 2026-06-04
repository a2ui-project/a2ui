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

/**
 * @fileoverview Reexports v0.8 renderer types.
 *
 * These types are aliases or re-exports of core types from `@a2ui/web_core/v0_8`.
 * Documentation for each type is available in the web core package.
 */

import * as WebCore from '@a2ui/web_core/v0_8';

// Messages & Infrastructure
export type Action = WebCore.Action;
export type FunctionCall = unknown;
export type SurfaceID = string;
export type StringValue = WebCore.StringValue;
export type BooleanValue = WebCore.BooleanValue;
export type NumberValue = WebCore.NumberValue;
export type Surface = WebCore.Surface;

export type A2UIClientEventMessage = WebCore.A2UIClientEventMessage;
export type ClientToServerMessage = A2UIClientEventMessage;
export type ServerToClientMessage = WebCore.ServerToClientMessage;

// Components & Interfaces
export interface Component<P = Record<string, unknown>> {
  id: string;
  type: string;
  properties: P;
}

export type AnyComponentNode = WebCore.AnyComponentNode;
export type CustomNode = WebCore.CustomNode;
export type Theme = WebCore.Theme;

// Node Types (Explicit suffix)
export type RowNode = WebCore.RowNode;
export type ColumnNode = WebCore.ColumnNode;
export type TextNode = WebCore.TextNode;
export type ListNode = WebCore.ListNode;
export type ImageNode = WebCore.ImageNode;
export type IconNode = WebCore.IconNode;
export type VideoNode = WebCore.VideoNode;
export type AudioPlayerNode = WebCore.AudioPlayerNode;
export type ButtonNode = WebCore.ButtonNode;
export type DividerNode = WebCore.DividerNode;
export type MultipleChoiceNode = WebCore.MultipleChoiceNode;
export type TextFieldNode = WebCore.TextFieldNode;
export type CheckboxNode = WebCore.CheckboxNode;
export type SliderNode = WebCore.SliderNode;
export type DateTimeInputNode = WebCore.DateTimeInputNode;
export type TabsNode = WebCore.TabsNode;
export type ModalNode = WebCore.ModalNode;
export type CardNode = WebCore.CardNode;

// Resolved Property Types
export type ResolvedRow = WebCore.ResolvedRow;
export type ResolvedColumn = WebCore.ResolvedColumn;
export type ResolvedText = WebCore.ResolvedText;
export type ResolvedList = WebCore.ResolvedList;
export type ResolvedImage = WebCore.ResolvedImage;
export type ResolvedIcon = WebCore.ResolvedIcon;
export type ResolvedVideo = WebCore.ResolvedVideo;
export type ResolvedAudioPlayer = WebCore.ResolvedAudioPlayer;
export type ResolvedButton = WebCore.ResolvedButton;
export type ResolvedDivider = WebCore.ResolvedDivider;
export type ResolvedMultipleChoice = WebCore.ResolvedMultipleChoice;
export type ResolvedTextField = WebCore.ResolvedTextField;
export type ResolvedCheckbox = WebCore.ResolvedCheckbox;
export type ResolvedSlider = WebCore.ResolvedSlider;
export type ResolvedDateTimeInput = WebCore.ResolvedDateTimeInput;
export type ResolvedTabs = WebCore.ResolvedTabs;
export type ResolvedModal = WebCore.ResolvedModal;
export type ResolvedCard = WebCore.ResolvedCard;

// Markdown
export type MarkdownRenderer = WebCore.MarkdownRenderer;
export type MarkdownRendererOptions = WebCore.MarkdownRendererOptions;
