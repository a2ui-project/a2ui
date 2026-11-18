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

import {z} from 'zod';

/**
 * The catalog schema file the build writes next to the app HTML (`*.catalog.json`). The server
 * validates the components it sends against the schema of each surface's catalog.
 */
export const CatalogSchemaFileSchema = z.object({
  /** The contract version the file was written for. */
  contractVersion: z.string(),
  /** The JSON schema of each catalog bundled in the app, keyed by catalog ID. */
  catalogs: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** The parsed content of a catalog schema file. */
export type CatalogSchemaFile = z.infer<typeof CatalogSchemaFileSchema>;
