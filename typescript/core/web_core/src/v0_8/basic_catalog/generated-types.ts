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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v0_8/json/standard_catalog_definition.json via scripts/generate-basic-catalog-types.mjs

/**
 * These types describe values as a message writes them (the input shape of
 * the schemas). The defaults the schemas declare are filled in at runtime,
 * so a validated value may carry a property its type marks optional.
 */

/** The theme of the catalog (`styles`). */
export interface Theme {
  /**
   * The primary font for the UI.
   */
  font?: string;
  /**
   * The primary UI color as a hexadecimal code (e.g., '#00BFFF').
   */
  primaryColor?: string;
}

/** The props of the `Text` component. */
export interface TextProps {
  /**
   * The text content to display. This can be a literal string or a reference to a value in the data model ('path', e.g., '/doc/title'). While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.
   */
  text: {
    literalString?: string;
    path?: string;
  };
  /**
   * A hint for the base text style. One of:
   * - `h1`: Largest heading.
   * - `h2`: Second largest heading.
   * - `h3`: Third largest heading.
   * - `h4`: Fourth largest heading.
   * - `h5`: Fifth largest heading.
   * - `caption`: Small text for captions.
   * - `body`: Standard body text.
   */
  usageHint?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
}

/** The props of the `Image` component. */
export interface ImageProps {
  /**
   * The URL of the image to display. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/url').
   */
  url: {
    literalString?: string;
    path?: string;
  };
  /**
   * The alt text for the image. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/altText').
   */
  altText?: {
    literalString?: string;
    path?: string;
  };
  /**
   * Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.
   */
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /**
   * A hint for the image size and style. One of:
   * - `icon`: Small square icon.
   * - `avatar`: Circular avatar image.
   * - `smallFeature`: Small feature image.
   * - `mediumFeature`: Medium feature image.
   * - `largeFeature`: Large feature image.
   * - `header`: Full-width, full bleed, header image.
   */
  usageHint?: 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';
}

/** The props of the `Icon` component. */
export interface IconProps {
  /**
   * The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit').
   */
  name: {
    literalString?:
      | 'accountCircle'
      | 'add'
      | 'arrowBack'
      | 'arrowForward'
      | 'attachFile'
      | 'calendarToday'
      | 'call'
      | 'camera'
      | 'check'
      | 'close'
      | 'delete'
      | 'download'
      | 'edit'
      | 'event'
      | 'error'
      | 'favorite'
      | 'favoriteOff'
      | 'folder'
      | 'help'
      | 'home'
      | 'info'
      | 'locationOn'
      | 'lock'
      | 'lockOpen'
      | 'mail'
      | 'menu'
      | 'moreVert'
      | 'moreHoriz'
      | 'notificationsOff'
      | 'notifications'
      | 'payment'
      | 'person'
      | 'phone'
      | 'photo'
      | 'print'
      | 'refresh'
      | 'search'
      | 'send'
      | 'settings'
      | 'share'
      | 'shoppingCart'
      | 'star'
      | 'starHalf'
      | 'starOff'
      | 'upload'
      | 'visibility'
      | 'visibilityOff'
      | 'warning';
    path?: string;
  };
}

/** The props of the `Video` component. */
export interface VideoProps {
  /**
   * The URL of the video to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/video/url').
   */
  url: {
    literalString?: string;
    path?: string;
  };
}

/** The props of the `AudioPlayer` component. */
export interface AudioPlayerProps {
  /**
   * The URL of the audio to be played. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/song/url').
   */
  url: {
    literalString?: string;
    path?: string;
  };
  /**
   * A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title').
   */
  description?: {
    literalString?: string;
    path?: string;
  };
}

/** The props of the `Row` component. */
export interface RowProps {
  /**
   * Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.
   */
  children: {
    explicitList?: Array<string>;
    /**
     * A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.
     */
    template?: {
      componentId: string;
      dataBinding: string;
    };
  };
  /**
   * Defines the arrangement of children along the main axis (horizontally). This corresponds to the CSS 'justify-content' property.
   */
  distribution?: 'center' | 'end' | 'spaceAround' | 'spaceBetween' | 'spaceEvenly' | 'start';
  /**
   * Defines the alignment of children along the cross axis (vertically). This corresponds to the CSS 'align-items' property.
   */
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

/** The props of the `Column` component. */
export interface ColumnProps {
  /**
   * Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.
   */
  children: {
    explicitList?: Array<string>;
    /**
     * A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.
     */
    template?: {
      componentId: string;
      dataBinding: string;
    };
  };
  /**
   * Defines the arrangement of children along the main axis (vertically). This corresponds to the CSS 'justify-content' property.
   */
  distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  /**
   * Defines the alignment of children along the cross axis (horizontally). This corresponds to the CSS 'align-items' property.
   */
  alignment?: 'center' | 'end' | 'start' | 'stretch';
}

/** The props of the `List` component. */
export interface ListProps {
  /**
   * Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.
   */
  children: {
    explicitList?: Array<string>;
    /**
     * A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.
     */
    template?: {
      componentId: string;
      dataBinding: string;
    };
  };
  /**
   * The direction in which the list items are laid out.
   */
  direction?: 'vertical' | 'horizontal';
  /**
   * Defines the alignment of children along the cross axis.
   */
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

/** The props of the `Card` component. */
export interface CardProps {
  /**
   * The ID of the component to be rendered inside the card.
   */
  child: string;
}

/** The props of the `Tabs` component. */
export interface TabsProps {
  /**
   * An array of objects, where each object defines a tab with a title and a child component.
   */
  tabItems: Array<{
    /**
     * The tab title. Defines the value as either a literal value or a path to data model value (e.g. '/options/title').
     */
    title: {
      literalString?: string;
      path?: string;
    };
    child: string;
  }>;
}

/** The props of the `Divider` component. */
export interface DividerProps {
  /**
   * The orientation of the divider.
   */
  axis?: 'horizontal' | 'vertical';
}

/** The props of the `Modal` component. */
export interface ModalProps {
  /**
   * The ID of the component that opens the modal when interacted with (e.g., a button).
   */
  entryPointChild: string;
  /**
   * The ID of the component to be displayed inside the modal.
   */
  contentChild: string;
}

/** The props of the `Button` component. */
export interface ButtonProps {
  /**
   * The ID of the component to display in the button, typically a Text component.
   */
  child: string;
  /**
   * Indicates if this button should be styled as the primary action.
   */
  primary?: boolean;
  /**
   * The client-side action to be dispatched when the button is clicked. It includes the action's name and an optional context payload.
   */
  action: {
    name: string;
    context?: Array<{
      key: string;
      /**
       * Defines the value to be included in the context as either a literal value or a path to a data model value (e.g. '/user/name').
       */
      value: {
        path?: string;
        literalString?: string;
        literalNumber?: number;
        literalBoolean?: boolean;
      };
    }>;
  };
}

/** The props of the `CheckBox` component. */
export interface CheckBoxProps {
  /**
   * The text to display next to the checkbox. Defines the value as either a literal value or a path to data model ('path', e.g. '/option/label').
   */
  label: {
    literalString?: string;
    path?: string;
  };
  /**
   * The current state of the checkbox (true for checked, false for unchecked). This can be a literal boolean ('literalBoolean') or a reference to a value in the data model ('path', e.g. '/filter/open').
   */
  value: {
    literalBoolean?: boolean;
    path?: string;
  };
}

/** The props of the `TextField` component. */
export interface TextFieldProps {
  /**
   * The text label for the input field. This can be a literal string or a reference to a value in the data model ('path, e.g. '/user/name').
   */
  label: {
    literalString?: string;
    path?: string;
  };
  /**
   * The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name').
   */
  text?: {
    literalString?: string;
    path?: string;
  };
  /**
   * The type of input field to display.
   */
  textFieldType?: 'date' | 'longText' | 'number' | 'shortText' | 'obscured';
  /**
   * A regular expression used for client-side validation of the input.
   */
  validationRegexp?: string;
}

/** The props of the `DateTimeInput` component. */
export interface DateTimeInputProps {
  /**
   * The selected date and/or time value in ISO 8601 format. This can be a literal string ('literalString') or a reference to a value in the data model ('path', e.g. '/user/dob').
   */
  value: {
    literalString?: string;
    path?: string;
  };
  /**
   * If true, allows the user to select a date.
   */
  enableDate?: boolean;
  /**
   * If true, allows the user to select a time.
   */
  enableTime?: boolean;
}

/** The props of the `MultipleChoice` component. */
export interface MultipleChoiceProps {
  /**
   * The currently selected values for the component. This can be a literal array of strings or a path to an array in the data model('path', e.g. '/hotel/options').
   */
  selections: {
    literalArray?: Array<string>;
    path?: string;
  };
  /**
   * An array of available options for the user to choose from.
   */
  options: Array<{
    /**
     * The text to display for this option. This can be a literal string or a reference to a value in the data model (e.g. '/option/label').
     */
    label: {
      literalString?: string;
      path?: string;
    };
    /**
     * The value to be associated with this option when selected.
     */
    value: string;
  }>;
  /**
   * The maximum number of options that the user is allowed to select.
   */
  maxAllowedSelections?: number;
  /**
   * The display style of the component.
   */
  variant?: 'checkbox' | 'chips';
  /**
   * If true, displays a search input to filter the options.
   */
  filterable?: boolean;
}

/** The props of the `Slider` component. */
export interface SliderProps {
  /**
   * The label for the slider. This can be a literal string or a reference to a value in the data model ('path').
   */
  label?: {
    literalString?: string;
    path?: string;
  };
  /**
   * The current value of the slider. This can be a literal number ('literalNumber') or a reference to a value in the data model ('path', e.g. '/restaurant/cost').
   */
  value: {
    literalNumber?: number;
    path?: string;
  };
  /**
   * The minimum value of the slider.
   */
  minValue?: number;
  /**
   * The maximum value of the slider.
   */
  maxValue?: number;
}

/** The props types of the catalog, by component name. */
export interface BasicCatalogProps {
  Text: TextProps;
  Image: ImageProps;
  Icon: IconProps;
  Video: VideoProps;
  AudioPlayer: AudioPlayerProps;
  Row: RowProps;
  Column: ColumnProps;
  List: ListProps;
  Card: CardProps;
  Tabs: TabsProps;
  Divider: DividerProps;
  Modal: ModalProps;
  Button: ButtonProps;
  CheckBox: CheckBoxProps;
  TextField: TextFieldProps;
  DateTimeInput: DateTimeInputProps;
  MultipleChoice: MultipleChoiceProps;
  Slider: SliderProps;
}
