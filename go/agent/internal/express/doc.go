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

// Package express implements the A2UI Express inference format: a pure-Go
// lexer and parser for Express.g4, a compiler from Express statements to A2UI
// wire messages (v0.9, v0.9.1 and v1.0), a decompiler back to Express, an
// incremental scope session for streaming, and a catalog-agnostic system
// prompt generator. The public API lives in package agent (ExpressFormat,
// ExpressParser, ExpressResponseStream); this package is internal.
package express
