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

/**
 * The `a2ui` module that apps import. The import map of the frame maps `a2ui` to the build of
 * this file. Its public surface must match `a2ui.d.ts`, which `a2ui_module.test.ts` checks.
 */

export {
  callFunction,
  dispatchAction,
  getData,
  setData,
  subscribe,
  useData,
  useFunction,
  type CallFunctionOptions,
  type FunctionState,
  type JsonCompatible,
  type JsonValue,
} from './data_api.js';
export {Button, Card, Slider, Stack, Text, type Space} from './primitives.js';
export {theme, useTheme, type Theme} from './theme.js';
export {VegaChart, type VegaChartProps} from './vega_chart.js';
