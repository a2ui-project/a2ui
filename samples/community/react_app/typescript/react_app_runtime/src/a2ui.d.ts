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
 * The `a2ui` module: everything a ReactApp can use besides `react`.
 *
 * A ReactApp is one TSX file that default-exports a component named `App`. It runs in a sandboxed
 * frame with no network access. It reaches the surface only through this module: data model
 * paths, catalog and agent functions, actions, the theme, charts and styled primitives.
 *
 * Paths are JSON pointers. `/loan/rate` addresses the surface data model; a path without a leading
 * slash resolves against the component's own data context (for example a `List` item).
 *
 * Each value the app sends (a `setData` or `useData` write, function `args`, action context) must
 * stay under 64 KB of JSON: keep big data in the data model and write ids.
 *
 * This file is part of the agent prompt, so every comment is written for the model.
 */
declare module 'a2ui' {
  import type {CSSProperties, ReactElement, ReactNode} from 'react';

  /** A value that survives JSON serialization. Everything sent to the surface must be one. */
  export type JsonValue =
    string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

  /**
   * `T` when every value it can hold is JSON. `setData` and `useData` require it, so a `Date`, a
   * `Map`, a function or a class instance fails to type-check: convert it first, for example with
   * `date.toISOString()`.
   */
  export type JsonCompatible<T> = {
    [K in keyof T]: [T[K]] extends [JsonValue]
      ? T[K]
      : T[K] extends (...args: never[]) => unknown
        ? never
        : JsonCompatible<T[K]>;
  } & ([T] extends [(...args: never[]) => unknown] ? never : unknown);

  // ---------------------------------------------------------------------------------------------
  // Data model
  // ---------------------------------------------------------------------------------------------

  /**
   * Reads a data model path and re-renders when it changes, like `useState` shared with the
   * surface. Native components bound to the same path (for example a `Slider` with
   * `value=$/loan/rate`) update when you call the setter, and the app re-renders when they change.
   *
   * The setter updates the app at once and then writes to the surface. Values must be JSON:
   * plain objects, arrays, strings, numbers, booleans and null. Interfaces and type aliases of
   * such values are fine as `T`; a `Date` or a function is not (see `JsonCompatible`).
   *
   * @param path JSON pointer, for example `/loan/rate`.
   * @param fallback Returned while the path holds no value.
   * @returns The current value and a setter, which also accepts an updater function.
   *
   * @example
   * const [rate, setRate] = useData<number>('/loan/rate', 5);
   */
  export function useData<T extends JsonCompatible<T>>(
    path: string,
    fallback: T,
  ): [T, (value: T | ((previous: T) => T)) => void];

  /** Reads a data model path once. Resolves to `undefined` when the path holds no value. */
  export function getData<T = JsonValue>(path: string): Promise<T | undefined>;

  /**
   * Writes a data model path. Resolves once the surface has applied the write. Prefer the setter
   * of `useData` inside components.
   */
  export function setData<T extends JsonCompatible<T>>(path: string, value: T): Promise<void>;

  /**
   * Calls `onChange` with the current value of a path and then on every change: the app's own
   * writes, native components and the agent. Returns a function that stops the subscription.
   */
  export function subscribe<T = JsonValue>(
    path: string,
    onChange: (value: T | undefined) => void,
  ): () => void;

  // ---------------------------------------------------------------------------------------------
  // Functions and actions
  // ---------------------------------------------------------------------------------------------

  /** Options of {@link callFunction}. */
  export interface CallFunctionOptions {
    /** Milliseconds before the call fails with a timeout. Defaults to 30000. */
    timeoutMs?: number;
  }

  /**
   * Calls a function by name: a catalog function that runs in the browser (for example
   * `formatCurrency`) or an agent function that runs on the server. Agent functions can take a
   * few seconds; show a loading state while you wait.
   *
   * @param name The function name, exactly as the catalog or the agent declares it.
   * @param args The named arguments. Values must be JSON.
   * @returns The function's result. Rejects with an `Error` when the call fails.
   *
   * @example
   * const label = await callFunction<string>('formatCurrency', {value: 1200, currency: 'USD'});
   */
  export function callFunction<R = JsonValue>(
    name: string,
    args?: {[key: string]: JsonValue},
    options?: CallFunctionOptions,
  ): Promise<R>;

  /** State of a call made by {@link useFunction}. */
  export interface FunctionState<R> {
    /** The result of the latest call, or `undefined` before it resolves. */
    data: R | undefined;
    /** True while the latest call is in flight. */
    loading: boolean;
    /** The error of the latest call, if it failed. */
    error: Error | undefined;
    /** Calls the function again with the same arguments. */
    refresh: () => void;
  }

  /**
   * Calls a function whenever `args` change (compared as JSON) and returns its state. Only the
   * latest call counts: a slower, older response never overwrites a newer one. Pass `null` as
   * `args` to skip calling.
   *
   * @example
   * const {data: minutes, loading} = useFunction<number>('estimateTravelTime', {stops});
   */
  export function useFunction<R = JsonValue>(
    name: string,
    args: {[key: string]: JsonValue} | null,
    options?: CallFunctionOptions,
  ): FunctionState<R>;

  /**
   * Sends an action to the agent, the same way a native `Button` with an `event` action does.
   * Use it when the user finishes something in the app that the agent should react to.
   */
  export function dispatchAction(name: string, context?: {[key: string]: JsonValue}): Promise<void>;

  // ---------------------------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------------------------

  /** The surface theme, so the app matches the native components around it. */
  export interface Theme {
    /** `light` or `dark`. */
    colorScheme: 'light' | 'dark';
    /** Resolved colors, for places that need a literal color (charts, canvas). */
    colors: {
      primary: string;
      onPrimary: string;
      secondary: string;
      background: string;
      onBackground: string;
      surface: string;
      onSurface: string;
      border: string;
    };
    /** Font family of the native components. */
    fontFamily: string;
    /** Every `--a2ui-*` CSS variable the host sent, keyed by name. */
    cssVars: {[name: string]: string};
  }

  /**
   * The current theme. In CSS, prefer `var(--a2ui-color-primary)` and friends; they update
   * automatically. Use `theme.colors` only where CSS variables don't work.
   */
  export const theme: Theme;

  /** The current theme; re-renders the component when the host theme changes. */
  export function useTheme(): Theme;

  // ---------------------------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------------------------

  /** Properties of {@link VegaChart}. */
  export interface VegaChartProps {
    /**
     * A Vega-Lite spec (https://vega.github.io/vega-lite/). Leave out colors and fonts: the chart
     * takes them from the theme. Leave out `width` to fill the container.
     */
    spec: {[key: string]: unknown};
    /**
     * Named datasets, for data that changes often. Refer to one in the spec with
     * `data: {name: 'table'}` and pass `data={{table: rows}}`; a change updates the chart in place
     * instead of redrawing it. A spec without `data` reads the dataset when there is only one.
     */
    data?: {[name: string]: unknown[]};
    /** Called with the data row of a clicked mark, or `null` when the click hits no mark. */
    onSelect?: (datum: {[field: string]: unknown} | null) => void;
    /**
     * Listeners for Vega signals, keyed by signal name. A Vega-Lite selection parameter named
     * `brush` is a signal named `brush`; its value maps each selected field to its range, for
     * example `{amount: [10, 40]}`, and is `{}` when the selection is cleared. With a `timeUnit`
     * Vega names the key `<timeUnit>_<field>` (`yearmonth_date`); the chart also adds the plain
     * field name (`date`), so read `value.date`. Temporal ranges are timestamps in milliseconds.
     */
    onSignal?: {[signal: string]: (value: unknown) => void};
    /** Height in CSS pixels. Defaults to the spec's height, else 240. */
    height?: number;
    className?: string;
    style?: CSSProperties;
  }

  /** Renders a Vega-Lite chart, themed to match the surface. */
  export function VegaChart(props: VegaChartProps): ReactElement;

  // ---------------------------------------------------------------------------------------------
  // Styled primitives. They use the theme, so the app looks like the native components.
  // ---------------------------------------------------------------------------------------------

  /** Spacing step: 0 is none, 1 is extra small, 2 small, 3 medium, 4 large, 5 extra large. */
  export type Space = 0 | 1 | 2 | 3 | 4 | 5;

  /** A bordered surface that groups content, with an optional title. */
  export function Card(props: {
    title?: ReactNode;
    children?: ReactNode;
    padding?: Space;
    className?: string;
    style?: CSSProperties;
  }): ReactElement;

  /** A button styled like the native `Button`. */
  export function Button(props: {
    children?: ReactNode;
    onClick?: () => void;
    /** `primary` for the main action, `borderless` for a link-like button. */
    variant?: 'default' | 'primary' | 'borderless';
    disabled?: boolean;
    type?: 'button' | 'submit';
    className?: string;
    style?: CSSProperties;
  }): ReactElement;

  /** Text styled like the native `Text`. */
  export function Text(props: {
    children?: ReactNode;
    /** `numeric` uses tabular digits, for numbers that change. */
    variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'numeric' | 'mono';
    /** `muted` for secondary text, `accent` for the primary color, `danger` for errors. */
    tone?: 'default' | 'muted' | 'accent' | 'danger';
    className?: string;
    style?: CSSProperties;
  }): ReactElement;

  /** A range input styled like the native `Slider`. */
  export function Slider(props: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    label?: ReactNode;
    /** Formats the value shown next to the label; hidden when omitted. */
    format?: (value: number) => string;
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
  }): ReactElement;

  /** Lays out children in a column (default) or a row, with a gap from the spacing scale. */
  export function Stack(props: {
    children?: ReactNode;
    direction?: 'vertical' | 'horizontal';
    /** Defaults to 2. */
    gap?: Space;
    align?: 'start' | 'center' | 'end' | 'stretch';
    justify?: 'start' | 'center' | 'end' | 'between';
    wrap?: boolean;
    className?: string;
    style?: CSSProperties;
  }): ReactElement;
}
