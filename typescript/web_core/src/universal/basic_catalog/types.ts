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

import type {ResolvedChildList} from '../../universal/index.js';

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

export interface UniversalAudioPlayerProps extends UniversalCommonProps {
  url?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export interface UniversalButtonProps extends UniversalCommonProps {
  child?: string;
  action?: () => void;
}

export interface UniversalCardProps extends UniversalCommonProps {
  child?: string;
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
  multiSelect?: boolean;
}

export interface UniversalColumnProps extends UniversalCommonProps {
  children?: ResolvedChildList;
  wrap?: boolean;
  justify?: string;
  align?: string;
}

export interface UniversalDateTimeInputProps extends UniversalCommonProps, UniversalCheckableProps {
  label?: string;
  value?: string;
  setValue?: (value: string) => void;
  mode?: 'date' | 'time' | 'datetime';
  min?: string;
  max?: string;
}

export interface UniversalDividerProps extends UniversalCommonProps {
  orientation?: 'horizontal' | 'vertical';
}

export interface UniversalIconProps extends UniversalCommonProps {
  name?: string;
  svgPath?: string;
}

export interface UniversalImageProps extends UniversalCommonProps {
  url?: string;
  alt?: string;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  aspectRatio?: string;
}

export interface UniversalListProps extends UniversalCommonProps {
  children?: ResolvedChildList;
}

export interface UniversalModalProps extends UniversalCommonProps {
  isOpen?: boolean;
  child?: string;
}

export interface UniversalRowProps extends UniversalCommonProps {
  children?: ResolvedChildList;
  wrap?: boolean;
  justify?: string;
  align?: string;
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
  child: string;
}

export interface UniversalTabsProps extends UniversalCommonProps {
  tabs?: UniversalTabItem[];
  selectedIndex?: number;
  onTabSelected?: (index: number) => void;
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
  type?: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url';
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  pattern?: string;
}

export interface UniversalVideoProps extends UniversalCommonProps {
  url?: string;
  poster?: string;
  posterUrl?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
}
