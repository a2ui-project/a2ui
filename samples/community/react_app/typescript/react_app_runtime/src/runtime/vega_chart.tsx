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

import {useEffect, useRef, useState, type CSSProperties, type ReactElement} from 'react';
import {getSession, toErrorDetails} from './session.js';
import {useTheme, type Theme} from './theme.js';

/** Properties of {@link VegaChart}; documented for the model in `a2ui.d.ts`. */
export interface VegaChartProps {
  spec: {[key: string]: unknown};
  data?: {[name: string]: unknown[]};
  onSelect?: (datum: {[field: string]: unknown} | null) => void;
  onSignal?: {[signal: string]: (value: unknown) => void};
  height?: number;
  className?: string;
  style?: CSSProperties;
}

type VegaEmbedModule = typeof import('vega-embed');
type VegaView = Awaited<ReturnType<VegaEmbedModule['default']>>['view'];

let vegaEmbedModule: Promise<VegaEmbedModule> | null = null;

/** Loads vega-embed (with Vega and Vega-Lite) once, on the first chart. */
function loadVegaEmbed(): Promise<VegaEmbedModule> {
  vegaEmbedModule ??= import('vega-embed');
  return vegaEmbedModule;
}

const DEFAULT_HEIGHT = 240;

/** A Vega-Lite config that takes colors and fonts from the theme. */
export function themeConfig(theme: Theme): Record<string, unknown> {
  const {colors, fontFamily} = theme;
  const axis = {
    labelColor: colors.onSurface,
    titleColor: colors.onSurface,
    gridColor: colors.border,
    domainColor: colors.border,
    tickColor: colors.border,
    labelFont: fontFamily,
    titleFont: fontFamily,
    titleFontWeight: 500,
  };
  return {
    background: 'transparent',
    font: fontFamily,
    mark: {color: colors.primary},
    axis,
    // Horizontal labels read better for the short categories apps chart (years, months).
    axisX: {labelAngle: 0},
    legend: {labelColor: colors.onSurface, titleColor: colors.onSurface},
    title: {color: colors.onSurface},
    view: {stroke: 'transparent'},
    range: {
      category: [colors.primary, colors.secondary, '#4e9a8f', '#d4a03a', '#7b6fb0', '#c8553d'],
    },
  };
}

const TIME_UNIT_KEY =
  /^(?:utc)?(?:year|quarter|month|week|day|dayofyear|date|hours|minutes|seconds|milliseconds)+_(.+)$/;

/**
 * Adds the plain field name next to each `<timeUnit>_<field>` key of a selection value
 * (`yearmonth_date` also gives `date`), so apps can read the field they encoded.
 */
export function withPlainFieldNames(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const out: Record<string, unknown> = {...(value as Record<string, unknown>)};
  for (const [key, entry] of Object.entries(value)) {
    const field = TIME_UNIT_KEY.exec(key)?.[1];
    if (field && !(field in out)) {
      out[field] = entry;
    }
  }
  return out;
}

/**
 * A spec without top-level data, passed exactly one named dataset, reads that dataset: models
 * often pass `data={{table: rows}}` and forget `data: {name: 'table'}` in the spec.
 */
export function withDefaultDataset(
  spec: Record<string, unknown>,
  datasetNames: string,
): Record<string, unknown> {
  const names = datasetNames ? datasetNames.split(',') : [];
  if (spec['data'] !== undefined || names.length !== 1) {
    return spec;
  }
  return {...spec, data: {name: names[0]}};
}

function datasetsOf(data: VegaChartProps['data']): Array<[string, unknown[]]> {
  return Object.entries(data ?? {}).filter((entry): entry is [string, unknown[]] =>
    Array.isArray(entry[1]),
  );
}

function replaceDataset(module: VegaEmbedModule, view: VegaView, name: string, rows: unknown[]) {
  try {
    view.change(
      name,
      module.vega
        .changeset()
        .remove(() => true)
        .insert(rows.map(row => (typeof row === 'object' && row !== null ? {...row} : row))),
    );
  } catch {
    // The spec has no dataset of that name; nothing to update.
  }
}

/**
 * Renders a Vega-Lite spec with vega-embed, themed from the host theme. The chart is embedded
 * again when the spec or the theme changes; named datasets in `data` are updated in place.
 */
export function VegaChart(props: VegaChartProps): ReactElement {
  const {spec, data, onSelect, onSignal, height, className, style} = props;
  const theme = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<{module: VegaEmbedModule; view: VegaView} | null>(null);
  const callbacks = useRef({onSelect, onSignal, data});
  callbacks.current = {onSelect, onSignal, data};
  const sentData = useRef(new Map<string, unknown[]>());
  const [error, setError] = useState<string | null>(null);

  const specKey = JSON.stringify(spec);
  const themeKey = JSON.stringify(theme);
  const signalNames = Object.keys(onSignal ?? {})
    .sort()
    .join(',');
  const datasetNames = datasetsOf(data)
    .map(([name]) => name)
    .sort()
    .join(',');

  useEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    let cancelled = false;
    let finalize: (() => void) | undefined;
    const chartHeight =
      height ?? (typeof spec['height'] === 'number' ? spec['height'] : DEFAULT_HEIGHT);
    const fullSpec = withDefaultDataset(
      {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        width: 'container',
        autosize: {type: 'fit', contains: 'padding'},
        ...(JSON.parse(specKey) as Record<string, unknown>),
        height: chartHeight,
      },
      datasetNames,
    );
    loadVegaEmbed()
      .then(async module => {
        if (cancelled) {
          return;
        }
        const result = await module.default(element, fullSpec as never, {
          actions: false,
          renderer: 'svg',
          config: themeConfig(theme) as never,
        });
        if (cancelled) {
          result.finalize();
          return;
        }
        finalize = () => result.finalize();
        view.current = {module, view: result.view};
        result.view.addEventListener('click', (_event, item) => {
          const datum = (item as {datum?: unknown} | null | undefined)?.datum;
          callbacks.current.onSelect?.(
            typeof datum === 'object' && datum !== null
              ? ({...(datum as Record<string, unknown>)} as {[field: string]: unknown})
              : null,
          );
        });
        for (const name of signalNames ? signalNames.split(',') : []) {
          try {
            result.view.addSignalListener(name, (_name, value) => {
              callbacks.current.onSignal?.[name]?.(withPlainFieldNames(value));
            });
          } catch {
            console.warn(`VegaChart: the spec has no signal named "${name}".`);
          }
        }
        sentData.current.clear();
        for (const [name, rows] of datasetsOf(callbacks.current.data)) {
          sentData.current.set(name, rows);
          replaceDataset(module, result.view, name, rows);
        }
        await result.view.runAsync();
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        const details = toErrorDetails(reason, 'VegaChart failed');
        setError(details.message);
        try {
          getSession().reportError('runtime', details);
        } catch {
          // Outside a frame (tests): the error card is enough.
        }
      });
    return () => {
      cancelled = true;
      view.current = null;
      finalize?.();
    };
    // `theme` is covered by `themeKey` and `spec` by `specKey`.
  }, [specKey, themeKey, signalNames, datasetNames, height]);

  // Runs after every render: `data` is usually an inline object, so only datasets whose array
  // changed are sent to the view.
  useEffect(() => {
    const current = view.current;
    if (!current) {
      return;
    }
    let changed = false;
    for (const [name, rows] of datasetsOf(data)) {
      if (sentData.current.get(name) !== rows) {
        sentData.current.set(name, rows);
        replaceDataset(current.module, current.view, name, rows);
        changed = true;
      }
    }
    if (changed) {
      current.view.runAsync().catch(() => {
        // Reported by the embed effect.
      });
    }
  });

  return (
    <div className={['a2ui-vega-chart', className].filter(Boolean).join(' ')} style={style}>
      <div ref={container} />
      {error !== null && (
        <p className="a2ui-text a2ui-text-caption a2ui-tone-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
