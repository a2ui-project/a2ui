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

import {createContext} from '@lit/context';
import * as Types from '@a2ui/web_core/types/types';

/**
 * The theme context.
 */
export const theme = createContext<Types.Theme | undefined>(Symbol('A2UITheme'));

/**
 * An alias for the theme context, for backwards-compatibility.
 *
 * @deprecated Use `theme` instead.
 */
export const themeContext = theme;
