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

// Package schemahelper crawls A2UI catalog schemas in a catalog-agnostic way
// for the compact inference formats. It inlines local $refs, derives the
// positional property and function-argument order (specific sub-schemas
// before common mixins, checks last), classifies static, data-binding,
// option-list and action slots, extracts protocol system functions, coalesces
// split v0.9 surface messages, and keeps JSON object key order for maps whose
// iteration order Go would otherwise randomize.
package schemahelper
