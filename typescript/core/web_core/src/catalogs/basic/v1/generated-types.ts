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
// Generated from catalogs/basic/v1/catalog.json via scripts/generate-basic-catalog-types.mjs

import type {
  Action,
  Checkable,
  Child,
  ChildList,
  DataBinding,
  DynamicBoolean,
  DynamicNumber,
  DynamicString,
  DynamicStringList,
} from '../../../types/common-types.js';

/**
 * The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.
 */
export type Weight = number;

/** The props of the `Text` component. */
export interface TextProps {
  /**
   * The text content to display. While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.
   */
  text: DynamicString;
  /**
   * A hint for the base text style.
   */
  variant?: 'caption' | 'body';
  weight?: Weight;
}

/** The props of the `Image` component. */
export interface ImageProps {
  /**
   * The URL of the image to display.
   */
  url: DynamicString;
  /**
   * Accessibility text for the image.
   */
  description?: DynamicString;
  /**
   * Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.
   */
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';
  /**
   * A hint for the image size and style.
   */
  variant?: 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';
  weight?: Weight;
}

/** The props of the `Icon` component. */
export interface IconProps {
  /**
   * The name of the icon to display.
   */
  name:
    | (
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
        | 'fastForward'
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
        | 'pause'
        | 'payment'
        | 'person'
        | 'phone'
        | 'photo'
        | 'play'
        | 'print'
        | 'refresh'
        | 'rewind'
        | 'search'
        | 'send'
        | 'settings'
        | 'share'
        | 'shoppingCart'
        | 'skipNext'
        | 'skipPrevious'
        | 'star'
        | 'starHalf'
        | 'starOff'
        | 'stop'
        | 'upload'
        | 'visibility'
        | 'visibilityOff'
        | 'volumeDown'
        | 'volumeMute'
        | 'volumeOff'
        | 'volumeUp'
        | 'warning'
      )
    | {
        svgPath: DynamicString;
      }
    | DataBinding;
  weight?: Weight;
}

/** The props of the `Video` component. */
export interface VideoProps {
  /**
   * The URL of the video to display.
   */
  url: DynamicString;
  /**
   * The URL of the poster image to display before the video plays.
   */
  posterUrl?: DynamicString;
  weight?: Weight;
}

/** The props of the `AudioPlayer` component. */
export interface AudioPlayerProps {
  /**
   * The URL of the audio to be played.
   */
  url: DynamicString;
  /**
   * A description of the audio, such as a title or summary.
   */
  description?: DynamicString;
  weight?: Weight;
}

/** The props of the `Row` component. */
export interface RowProps {
  /**
   * Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.
   */
  children: ChildList;
  /**
   * Defines the arrangement of children along the main axis (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' to pack them together.
   */
  justify?: 'center' | 'end' | 'spaceAround' | 'spaceBetween' | 'spaceEvenly' | 'start' | 'stretch';
  /**
   * Defines the alignment of children along the cross axis (vertically). This is similar to the CSS 'align-items' property, but uses camelCase values (e.g., 'start').
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  weight?: Weight;
}

/** The props of the `Column` component. */
export interface ColumnProps {
  /**
   * Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.
   */
  children: ChildList;
  /**
   * Defines the arrangement of children along the main axis (vertically). Use 'spaceBetween' to push items to the edges (e.g. header at top, footer at bottom), or 'start'/'end'/'center' to pack them together.
   */
  justify?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly' | 'stretch';
  /**
   * Defines the alignment of children along the cross axis (horizontally). This is similar to the CSS 'align-items' property.
   */
  align?: 'center' | 'end' | 'start' | 'stretch';
  weight?: Weight;
}

/** The props of the `List` component. */
export interface ListProps {
  /**
   * Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.
   */
  children: ChildList;
  /**
   * The direction in which the list items are laid out.
   */
  direction?: 'vertical' | 'horizontal';
  /**
   * Defines the alignment of children along the cross axis.
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  weight?: Weight;
}

/** The props of the `Card` component. */
export interface CardProps {
  /**
   * The ID of the single child component to be rendered inside the card. To display multiple elements, you MUST wrap them in a layout component (like Column or Row) and pass that container's ID here. Do NOT pass multiple IDs or a non-existent ID.
   */
  child: Child;
  weight?: Weight;
}

/** The props of the `Tabs` component. */
export interface TabsProps {
  /**
   * An array of objects, where each object defines a tab with a title and a child component.
   */
  tabs: Array<{
    /**
     * The tab title.
     */
    title: DynamicString;
    /**
     * The ID of the child component.
     */
    child: Child;
  }>;
  weight?: Weight;
}

/** The props of the `Modal` component. */
export interface ModalProps {
  /**
   * The ID of the component that opens the modal when interacted with (e.g., a button).
   */
  trigger: Child;
  /**
   * The ID of the component to be displayed inside the modal.
   */
  content: Child;
  weight?: Weight;
}

/** The props of the `Divider` component. */
export interface DividerProps {
  /**
   * The orientation of the divider.
   */
  axis?: 'horizontal' | 'vertical';
  weight?: Weight;
}

/** The props of the `Button` component. */
export interface ButtonProps extends Checkable {
  /**
   * The ID of the child component. Use a 'Text' component for a labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only button.
   */
  child: Child;
  /**
   * A hint for the button style. If omitted, a default button style is used. 'primary' indicates this is the main call-to-action button. 'borderless' means the button has no visual border or background, making its child content appear like a clickable link.
   */
  variant?: 'default' | 'primary' | 'borderless';
  action: Action;
  weight?: Weight;
}

/** The props of the `TextField` component. */
export interface TextFieldProps extends Checkable {
  /**
   * The text label for the input field.
   */
  label: DynamicString;
  /**
   * The value of the text field.
   */
  value: DynamicString;
  /**
   * The placeholder text for the input field.
   */
  placeholder?: DynamicString;
  /**
   * The type of input field to display.
   */
  variant?: 'longText' | 'number' | 'shortText' | 'obscured';
  weight?: Weight;
}

/** The props of the `CheckBox` component. */
export interface CheckBoxProps extends Checkable {
  /**
   * The text to display next to the checkbox.
   */
  label: DynamicString;
  /**
   * The current state of the checkbox (true for checked, false for unchecked).
   */
  value: DynamicBoolean;
  weight?: Weight;
}

/** The props of the `ChoicePicker` component. */
export interface ChoicePickerProps extends Checkable {
  /**
   * The label for the group of options.
   */
  label?: DynamicString;
  /**
   * A hint for how the choice picker should be displayed and behave.
   */
  variant?: 'multipleSelection' | 'mutuallyExclusive';
  /**
   * The list of available options to choose from.
   */
  options: Array<{
    /**
     * The text to display for this option.
     */
    label: DynamicString;
    /**
     * The stable value associated with this option.
     */
    value: string;
  }>;
  /**
   * The list of currently selected values. This should be bound to a string array in the data model.
   */
  value: DynamicStringList;
  /**
   * The display style of the component.
   */
  displayStyle?: 'checkbox' | 'chips';
  /**
   * If true, displays a search input to filter the options.
   */
  filterable?: boolean;
  weight?: Weight;
}

/** The props of the `Slider` component. */
export interface SliderProps extends Checkable {
  /**
   * The label for the slider.
   */
  label?: DynamicString;
  /**
   * The minimum value of the slider.
   */
  min?: number;
  /**
   * The maximum value of the slider.
   */
  max: number;
  /**
   * The current value of the slider.
   */
  value: DynamicNumber;
  /**
   * The number of discrete divisions in the slider range. If specified, the slider will snap to discrete values.
   */
  steps?: number;
  weight?: Weight;
}

/** The props of the `DateTimeInput` component. */
export interface DateTimeInputProps extends Checkable {
  /**
   * The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string.
   */
  value: DynamicString;
  /**
   * If true, allows the user to select a date.
   */
  enableDate?: boolean;
  /**
   * If true, allows the user to select a time.
   */
  enableTime?: boolean;
  /**
   * The minimum allowed date/time in ISO 8601 format.
   */
  min?: DynamicString;
  /**
   * The maximum allowed date/time in ISO 8601 format.
   */
  max?: DynamicString;
  /**
   * The text label for the input field.
   */
  label?: DynamicString;
  weight?: Weight;
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
  Modal: ModalProps;
  Divider: DividerProps;
  Button: ButtonProps;
  TextField: TextFieldProps;
  CheckBox: CheckBoxProps;
  ChoicePicker: ChoicePickerProps;
  Slider: SliderProps;
  DateTimeInput: DateTimeInputProps;
}
