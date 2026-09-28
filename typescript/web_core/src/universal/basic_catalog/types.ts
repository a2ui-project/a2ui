/*
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

import type {ResolvedChildList, A2uiChildRef} from '../../universal/index.js';

export type {A2uiChildRef};

/**
 * Universal accessibility attributes rendered on basic catalog custom elements.
 */
export interface UniversalAccessibilityAttributes {
  label?: string;
  description?: string;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: boolean;
}

/** Base properties common to all universal basic catalog component views. */
export interface UniversalCommonProps {
  weight?: number;
  accessibility?: UniversalAccessibilityAttributes;
}

/** Checkable mixin properties for components that support input validation rules. */
export interface UniversalCheckableProps {
  validationErrors?: string[];
  isValid?: boolean;
}

export type UniversalLayoutJustify =
  | 'start'
  | 'center'
  | 'end'
  | 'spaceBetween'
  | 'spaceAround'
  | 'spaceEvenly'
  | 'stretch';

export type UniversalLayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

export interface UniversalAudioPlayerProps extends UniversalCommonProps {
  url?: string;
  description?: string;
}

export interface UniversalButtonProps extends UniversalCommonProps, UniversalCheckableProps {
  child?: A2uiChildRef;
  action?: () => void;
  variant?: 'default' | 'primary' | 'borderless';
}

export interface UniversalCardProps extends UniversalCommonProps {
  child?: A2uiChildRef;
  children?: ResolvedChildList;
}

export interface UniversalCheckBoxProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: boolean;
  setValue?: (value: boolean) => void;
}

export interface UniversalChoicePickerOption {
  label: string;
  value: string;
}

export interface UniversalChoicePickerProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: string | string[];
  setValue?: (value: string | string[]) => void;
  options?: UniversalChoicePickerOption[];
  variant?: 'multipleSelection' | 'mutuallyExclusive';
  displayStyle?: 'checkbox' | 'chips';
  filterable?: boolean;
}

export interface UniversalColumnProps extends UniversalCommonProps {
  children?: ResolvedChildList;
  wrap?: boolean;
  justify?: UniversalLayoutJustify;
  align?: UniversalLayoutAlign;
}

export interface UniversalDateTimeInputProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: string;
  setValue?: (value: string) => void;
  enableDate?: boolean;
  enableTime?: boolean;
  min?: string;
  max?: string;
}

export interface UniversalDividerProps extends UniversalCommonProps {
  axis?: 'horizontal' | 'vertical';
}

export interface UniversalIconProps extends UniversalCommonProps {
  name?: string | {svgPath: string};
}

export interface UniversalImageProps extends UniversalCommonProps {
  url?: string;
  description?: string;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';
  variant?:
    | 'icon'
    | 'avatar'
    | 'smallFeature'
    | 'mediumFeature'
    | 'largeFeature'
    | 'header'
    | 'default';
}

export interface UniversalListProps extends UniversalCommonProps {
  children?: ResolvedChildList;
  direction?: 'vertical' | 'horizontal';
  listStyle?: 'ordered' | 'unordered' | 'none';
}

export interface UniversalModalProps extends UniversalCommonProps {
  trigger?: A2uiChildRef;
  content?: A2uiChildRef;
}

export interface UniversalRowProps extends UniversalCommonProps {
  children?: ResolvedChildList;
  wrap?: boolean;
  justify?: UniversalLayoutJustify;
  align?: UniversalLayoutAlign;
}

export interface UniversalSliderProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: number;
  setValue?: (value: number) => void;
  min?: number;
  max?: number;
  steps?: number;
}

export interface UniversalTabItem {
  title: string;
  child: A2uiChildRef;
}

export interface UniversalTabsProps extends UniversalCommonProps {
  tabs?: UniversalTabItem[];
}

export interface UniversalTextProps extends UniversalCommonProps {
  text?: string | number;
  variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
}

export interface UniversalTextFieldProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: string;
  setValue?: (value: string) => void;
  placeholder?: string;
  variant?: 'shortText' | 'longText' | 'number' | 'obscured' | 'email' | 'phone' | 'url';
}

export interface UniversalVideoProps extends UniversalCommonProps {
  url?: string;
  poster?: string;
  posterUrl?: string;
}
