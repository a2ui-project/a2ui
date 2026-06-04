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

export {
  type ClientToServerMessage as A2UIClientEventMessage,
  type ClientCapabilitiesDynamic,
} from './client-event.js';
export {type Action} from './components.js';

import {
  AudioPlayer,
  Button,
  Card,
  Checkbox,
  Column,
  DateTimeInput,
  Divider,
  Icon,
  Image,
  List,
  Modal,
  MultipleChoice,
  Row,
  Slider,
  Tabs,
  Text,
  TextField,
  Video,
} from './components';

import type {z} from 'zod';
import type {
  A2uiMessageSchema,
  BeginRenderingMessageSchema,
  ComponentInstanceSchema,
  ComponentPropertiesSchema,
  DataModelUpdateMessageSchema,
  DeleteSurfaceMessageSchema,
  SurfaceUpdateMessageSchema,
  ValueMapSchema,
} from '../schema/server-to-client.js';
import type {
  ComponentArrayReferenceSchema,
  ComponentArrayTemplateSchema,
} from '../schema/common-types.js';
import {StringValue, NumberValue, BooleanValue} from './primitives';
export type {StringValue, NumberValue, BooleanValue};

export type MessageProcessor = {
  getSurfaces(): ReadonlyMap<string, Surface>;
  clearSurfaces(): void;
  processMessages(messages: ServerToClientMessage[]): void;

  /**
   * Retrieves the data for a given component node and a relative path string.
   * This correctly handles the special `.` path, which refers to the node's
   * own data context.
   */
  getData(node: AnyComponentNode, relativePath: string, surfaceId: string): DataValue | null;

  setData(
    node: AnyComponentNode | null,
    relativePath: string,
    value: DataValue,
    surfaceId: string,
  ): void;

  resolvePath(path: string, dataContextPath?: string): string;
};

export declare type Theme = {
  components: {
    AudioPlayer: Record<string, boolean>;
    Button: Record<string, boolean>;
    Card: Record<string, boolean>;
    Column: Record<string, boolean>;
    CheckBox: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      label: Record<string, boolean>;
    };
    DateTimeInput: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      label: Record<string, boolean>;
    };
    Divider: Record<string, boolean>;
    Image: {
      all: Record<string, boolean>;
      icon: Record<string, boolean>;
      avatar: Record<string, boolean>;
      smallFeature: Record<string, boolean>;
      mediumFeature: Record<string, boolean>;
      largeFeature: Record<string, boolean>;
      header: Record<string, boolean>;
    };
    Icon: Record<string, boolean>;
    List: Record<string, boolean>;
    Modal: {
      backdrop: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    MultipleChoice: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      label: Record<string, boolean>;
    };
    Row: Record<string, boolean>;
    Slider: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      label: Record<string, boolean>;
    };
    Tabs: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      controls: {
        all: Record<string, boolean>;
        selected: Record<string, boolean>;
      };
    };
    Text: {
      all: Record<string, boolean>;
      h1: Record<string, boolean>;
      h2: Record<string, boolean>;
      h3: Record<string, boolean>;
      h4: Record<string, boolean>;
      h5: Record<string, boolean>;
      caption: Record<string, boolean>;
      body: Record<string, boolean>;
    };
    TextField: {
      container: Record<string, boolean>;
      element: Record<string, boolean>;
      label: Record<string, boolean>;
    };
    Video: Record<string, boolean>;
  };
  elements: {
    a: Record<string, boolean>;
    audio: Record<string, boolean>;
    body: Record<string, boolean>;
    button: Record<string, boolean>;
    h1: Record<string, boolean>;
    h2: Record<string, boolean>;
    h3: Record<string, boolean>;
    h4: Record<string, boolean>;
    h5: Record<string, boolean>;
    iframe: Record<string, boolean>;
    input: Record<string, boolean>;
    p: Record<string, boolean>;
    pre: Record<string, boolean>;
    textarea: Record<string, boolean>;
    video: Record<string, boolean>;
  };
  markdown: {
    p: string[];
    h1: string[];
    h2: string[];
    h3: string[];
    h4: string[];
    h5: string[];
    ul: string[];
    ol: string[];
    li: string[];
    a: string[];
    strong: string[];
    em: string[];
  };
  additionalStyles?: {
    AudioPlayer?: Record<string, string>;
    Button?: Record<string, string>;
    Card?: Record<string, string>;
    Column?: Record<string, string>;
    CheckBox?: Record<string, string>;
    DateTimeInput?: Record<string, string>;
    Divider?: Record<string, string>;
    Heading?: Record<string, string>;
    Icon?: Record<string, string>;
    Image?: Record<string, string>;
    List?: Record<string, string>;
    Modal?: Record<string, string>;
    MultipleChoice?: Record<string, string>;
    Row?: Record<string, string>;
    Slider?: Record<string, string>;
    Tabs?: Record<string, string>;
    Text?:
      | Record<string, string>
      | {
          h1: Record<string, string>;
          h2: Record<string, string>;
          h3: Record<string, string>;
          h4: Record<string, string>;
          h5: Record<string, string>;
          body: Record<string, string>;
          caption: Record<string, string>;
        };
    TextField?: Record<string, string>;
    Video?: Record<string, string>;
  };
};

/**
 * Represents a user-initiated action, sent from the client to the server.
 */
export declare interface UserAction {
  /**
   * The name of the action, taken from the component's `action.action`
   * property.
   */
  actionName: string;
  /**
   * The `id` of the component that triggered the event.
   */
  sourceComponentId: string;
  /**
   * An ISO 8601 timestamp of when the event occurred.
   */
  timestamp: string;
  /**
   * A JSON object containing the key-value pairs from the component's
   * `action.context`, after resolving all data bindings.
   */
  context?: {
    [k: string]: unknown;
  };
}

/** A recursive type for any valid JSON-like value in the data model. */
export declare type DataValue = string | number | boolean | null | DataMap | DataObject | DataArray;
export declare type DataObject = {[key: string]: DataValue};
export declare type DataMap = Map<string, DataValue>;
export declare type DataArray = DataValue[];

/** A template for creating components from a list in the data model. */
export declare interface ComponentArrayTemplate extends z.infer<
  typeof ComponentArrayTemplateSchema
> {
  componentId: string;
  dataBinding: string;
}

/** Defines a list of child components, either explicitly or via a template. */
export declare interface ComponentArrayReference extends z.infer<
  typeof ComponentArrayReferenceSchema
> {
  explicitList?: string[];
  template?: ComponentArrayTemplate;
}

/** Represents the general shape of a component's properties. */
export declare interface ComponentProperties extends z.infer<typeof ComponentPropertiesSchema> {
  Text?: Text;
  Image?: Image;
  Icon?: Icon;
  Video?: Video;
  AudioPlayer?: AudioPlayer;
  Row?: Row;
  Column?: Column;
  List?: List;
  Card?: Card;
  Tabs?: Tabs;
  Divider?: Divider;
  Modal?: Modal;
  Button?: Button;
  Checkbox?: Checkbox;
  TextField?: TextField;
  DateTimeInput?: DateTimeInput;
  MultipleChoice?: MultipleChoice;
  Slider?: Slider;
}

/** A raw component instance from a SurfaceUpdate message. */
export declare interface ComponentInstance extends z.infer<typeof ComponentInstanceSchema> {
  id: string;
  weight?: number;
  component: ComponentProperties;
}

export declare interface BeginRenderingMessage extends z.infer<typeof BeginRenderingMessageSchema> {
  surfaceId: string;
  root: string;
  styles?: {
    font?: string;
    primaryColor?: string;
  };
}

export declare interface SurfaceUpdateMessage extends z.infer<typeof SurfaceUpdateMessageSchema> {
  surfaceId: string;
  components: ComponentInstance[];
}

export declare interface DataModelUpdate extends z.infer<typeof DataModelUpdateMessageSchema> {
  surfaceId: string;
  path?: string;
  contents: ValueMap[];
}

// ValueMap is a type of DataObject for passing to the data model.
export declare interface ValueMap extends z.infer<typeof ValueMapSchema> {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: ValueMap[];
}

export declare interface DeleteSurfaceMessage extends z.infer<typeof DeleteSurfaceMessageSchema> {
  surfaceId: string;
}

export declare interface ServerToClientMessage extends z.infer<typeof A2uiMessageSchema> {
  beginRendering?: BeginRenderingMessage;
  surfaceUpdate?: SurfaceUpdateMessage;
  dataModelUpdate?: DataModelUpdate;
  deleteSurface?: DeleteSurfaceMessage;
}

/**
 * A recursive type for any value that can appear within a resolved component
 * tree. This is the main type that makes the recursive resolution possible.
 */
export declare type ResolvedValue =
  | string
  | number
  | boolean
  | null
  | AnyComponentNode
  | ResolvedMap
  | ResolvedArray;

/** A generic map where each value has been recursively resolved. */
export declare type ResolvedMap = {[key: string]: ResolvedValue};

/** A generic array where each item has been recursively resolved. */
export declare type ResolvedArray = ResolvedValue[];

/**
 * A base interface that all component nodes share.
 */
interface BaseComponentNode {
  id: string;
  weight?: number;
  dataContextPath?: string;
  slotName?: string;
}

export declare interface TextNode extends BaseComponentNode {
  type: 'Text';
  properties: ResolvedText;
}

export declare interface ImageNode extends BaseComponentNode {
  type: 'Image';
  properties: ResolvedImage;
}

export declare interface IconNode extends BaseComponentNode {
  type: 'Icon';
  properties: ResolvedIcon;
}

export declare interface VideoNode extends BaseComponentNode {
  type: 'Video';
  properties: ResolvedVideo;
}

export declare interface AudioPlayerNode extends BaseComponentNode {
  type: 'AudioPlayer';
  properties: ResolvedAudioPlayer;
}

export declare interface RowNode extends BaseComponentNode {
  type: 'Row';
  properties: ResolvedRow;
}

export declare interface ColumnNode extends BaseComponentNode {
  type: 'Column';
  properties: ResolvedColumn;
}

export declare interface ListNode extends BaseComponentNode {
  type: 'List';
  properties: ResolvedList;
}

export declare interface CardNode extends BaseComponentNode {
  type: 'Card';
  properties: ResolvedCard;
}

export declare interface TabsNode extends BaseComponentNode {
  type: 'Tabs';
  properties: ResolvedTabs;
}

export declare interface DividerNode extends BaseComponentNode {
  type: 'Divider';
  properties: ResolvedDivider;
}

export declare interface ModalNode extends BaseComponentNode {
  type: 'Modal';
  properties: ResolvedModal;
}

export declare interface ButtonNode extends BaseComponentNode {
  type: 'Button';
  properties: ResolvedButton;
}

export declare interface CheckboxNode extends BaseComponentNode {
  type: 'CheckBox';
  properties: ResolvedCheckbox;
}

export declare interface TextFieldNode extends BaseComponentNode {
  type: 'TextField';
  properties: ResolvedTextField;
}

export declare interface DateTimeInputNode extends BaseComponentNode {
  type: 'DateTimeInput';
  properties: ResolvedDateTimeInput;
}

export declare interface MultipleChoiceNode extends BaseComponentNode {
  type: 'MultipleChoice';
  properties: ResolvedMultipleChoice;
}

export declare interface SliderNode extends BaseComponentNode {
  type: 'Slider';
  properties: ResolvedSlider;
}

export declare interface CustomNode extends BaseComponentNode {
  type: string;
  // For custom nodes, properties are just a map of string keys to any resolved value.
  properties: CustomNodeProperties;
}

/**
 * The complete discriminated union of all possible resolved component nodes.
 * A renderer would use this type for any given node in the component tree.
 */
export declare type AnyComponentNode =
  | TextNode
  | IconNode
  | ImageNode
  | VideoNode
  | AudioPlayerNode
  | RowNode
  | ColumnNode
  | ListNode
  | CardNode
  | TabsNode
  | DividerNode
  | ModalNode
  | ButtonNode
  | CheckboxNode
  | TextFieldNode
  | DateTimeInputNode
  | MultipleChoiceNode
  | SliderNode
  | CustomNode;

// These components do not contain other components can reuse their
// original interfaces.
export declare type ResolvedText = Text;
export declare type ResolvedIcon = Icon;
export declare type ResolvedImage = Image;
export declare type ResolvedVideo = Video;
export declare type ResolvedAudioPlayer = AudioPlayer;
export declare type ResolvedDivider = Divider;
export declare type ResolvedCheckbox = Checkbox;
export declare type ResolvedTextField = TextField;
export declare type ResolvedDateTimeInput = DateTimeInput;
export declare type ResolvedMultipleChoice = MultipleChoice;
export declare type ResolvedSlider = Slider;

export declare interface ResolvedRow {
  children: AnyComponentNode[];
  distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface ResolvedColumn {
  children: AnyComponentNode[];
  distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface ResolvedButton {
  child: AnyComponentNode;
  action: Button['action'];
  primary?: boolean;
}

export declare interface ResolvedList {
  children: AnyComponentNode[];
  direction?: 'vertical' | 'horizontal';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface ResolvedCard {
  child: AnyComponentNode;
  children: AnyComponentNode[];
}

export declare interface ResolvedTabItem {
  title: StringValue;
  child: AnyComponentNode;
}

export declare interface ResolvedTabs {
  tabItems: ResolvedTabItem[];
}

export declare interface ResolvedModal {
  entryPointChild: AnyComponentNode;
  contentChild: AnyComponentNode;
}

export declare interface CustomNodeProperties {
  [k: string]: ResolvedValue;
}

export declare type SurfaceID = string;

/** The complete state of a single UI surface. */
export declare interface Surface {
  rootComponentId: string | null;
  componentTree: AnyComponentNode | null;
  dataModel: DataMap;
  components: Map<string, ComponentInstance>;
  styles: Record<string, string>;
}

// Markdown rendering
/**
 * Renders `markdown` using `options`.
 *
 * Implementations MUST sanitize the resulting HTML to prevent XSS vulnerabilities.
 *
 * @returns A promise that resolves to the rendered, sanitized HTML as a string.
 */
export declare type MarkdownRenderer = (
  markdown: string,
  options?: MarkdownRendererOptions,
) => Promise<string>;

/**
 * A map of tag names to a list of classnames to be applied to a tag.
 *
 * For example, if you want to apply the class "my-class" to all "h1" tags,
 * you would use `{"h1": ["my-class"]}`.
 */
export declare type MarkdownRendererTagClassMap = Record<string, string[]>;

/**
 * The options for the markdown renderer passed from A2UI.
 *
 * This includes the tagClassMap, which is a map of tag names to a list of
 * classnames to be applied to each tag, and configuration for the sanitizer.
 */
export declare type MarkdownRendererOptions = {
  tagClassMap?: MarkdownRendererTagClassMap;
};
