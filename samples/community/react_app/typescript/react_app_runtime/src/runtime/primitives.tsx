/*
 * Copyright 2026 Google LLC
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

/**
 * Styled primitives of the `a2ui` module. They only set class names; `a2ui-lite.css` styles the
 * classes with the `--a2ui-*` variables the host sends, so they match the native components.
 */

import {useId, type CSSProperties, type ReactElement, type ReactNode} from 'react';

/** Spacing step, mapped to the `--a2ui-spacing-*` scale by `a2ui-lite.css`. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5;

interface StyleProps {
  className?: string;
  style?: CSSProperties;
}

function classes(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export function Card(
  props: {title?: ReactNode; children?: ReactNode; padding?: Space} & StyleProps,
): ReactElement {
  const {title, children, padding = 3, className, style} = props;
  return (
    <section className={classes('a2ui-card', `a2ui-pad-${padding}`, className)} style={style}>
      {title !== undefined && <h3 className="a2ui-card-title">{title}</h3>}
      {children}
    </section>
  );
}

export function Button(
  props: {
    children?: ReactNode;
    onClick?: () => void;
    variant?: 'default' | 'primary' | 'borderless';
    disabled?: boolean;
    type?: 'button' | 'submit';
  } & StyleProps,
): ReactElement {
  const {
    children,
    onClick,
    variant = 'default',
    disabled,
    type = 'button',
    className,
    style,
  } = props;
  return (
    <button
      type={type}
      className={classes('a2ui-button', `a2ui-button-${variant}`, className)}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}

const TEXT_TAGS = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  body: 'p',
  caption: 'p',
  numeric: 'span',
  mono: 'code',
} as const;

export function Text(
  props: {
    children?: ReactNode;
    variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'numeric' | 'mono';
    tone?: 'default' | 'muted' | 'accent' | 'danger';
  } & StyleProps,
): ReactElement {
  const {children, variant = 'body', tone = 'default', className, style} = props;
  const Tag = TEXT_TAGS[variant] ?? 'p';
  return (
    <Tag
      className={classes('a2ui-text', `a2ui-text-${variant}`, `a2ui-tone-${tone}`, className)}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function Slider(
  props: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    label?: ReactNode;
    format?: (value: number) => string;
    disabled?: boolean;
  } & StyleProps,
): ReactElement {
  const {value, onChange, min = 0, max = 100, step = 1, label, format, disabled} = props;
  const id = useId();
  return (
    <div className={classes('a2ui-slider', props.className)} style={props.style}>
      {(label !== undefined || format) && (
        <label className="a2ui-slider-label" htmlFor={id}>
          <span>{label}</span>
          {format && <span className="a2ui-text-numeric">{format(value)}</span>}
        </label>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

export function Stack(
  props: {
    children?: ReactNode;
    direction?: 'vertical' | 'horizontal';
    gap?: Space;
    align?: 'start' | 'center' | 'end' | 'stretch';
    justify?: 'start' | 'center' | 'end' | 'between';
    wrap?: boolean;
  } & StyleProps,
): ReactElement {
  const {children, direction = 'vertical', gap = 2, align, justify, wrap, className, style} = props;
  return (
    <div
      className={classes(
        'a2ui-stack',
        `a2ui-stack-${direction}`,
        `a2ui-gap-${gap}`,
        align && `a2ui-align-${align}`,
        justify && `a2ui-justify-${justify}`,
        wrap && 'a2ui-wrap',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
