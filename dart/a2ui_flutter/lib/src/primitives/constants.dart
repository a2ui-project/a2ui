// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// The catalog ID for the basic catalog.
const String basicCatalogId =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/// Legacy catalog ID for the basic catalog, kept for backwards compatibility.
@Deprecated(
  'Use basicCatalogId instead. This URL is non-canonical and retained for '
  'backwards compatibility.',
)
const String legacyBasicCatalogId =
    'https://a2ui.org/specification/v0_9/basic_catalog.json';

/// The schema URI for common A2UI types.
const String commonTypesSchemaId =
    'https://a2ui.org/specification/v0_9/common_types.json';
