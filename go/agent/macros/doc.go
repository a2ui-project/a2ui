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

// Package macros lets an agent offer the model composite components ("macros")
// that the server expands into Basic Catalog primitives before messages reach the
// renderer.
//
// Define a macro with NewMacro or NewPureMacro. The Args struct declares its
// parameters (struct tags set the wire name, desc, enum and default), and the
// expand function returns a builder tree:
//
//	type badgeArgs struct {
//		Label string `json:"label" desc:"Badge text"`
//	}
//	badge := macros.MustNewPureMacro("Badge", "A labelled card.", func(a badgeArgs) *v1.Card {
//		return v1.NewCard(v1.NewText(v1.Str(a.Label)))
//	})
//
// A MacroExpander then works in both directions:
//
//   - Inference: TransformCatalogs (or TransformToInferenceCatalog) adds the macro
//     schemas to the catalogs used for prompting and parsing. In v1.0 they ship as
//     a separate sidecar catalog (ToCatalog).
//   - Transport: TransformToTransport replaces each macro invocation with its
//     flattened primitive subtree, scoping generated IDs under the invocation's ID
//     and stamping @catalogId where the surface needs it.
//
// The envelope fields of a macro invocation are not passed to the macro.
// TransformToTransport merges accessibility and metadata onto the root of the
// expansion and appends checks to the root's checks, writing them as
// @accessibility, @metadata and @checks from v1.0 (v0.9 keeps accessibility and
// checks bare and drops metadata). A v1.0 invocation may also use the bare keys of
// payloads written before the @ prefix, unless the macro declares a parameter of
// that name. The invocation's @catalogId selects the macro catalog and is not
// copied.
//
// Build one MacroExpander at startup and share it. Create a TransportSession per
// conversation with NewSession so that surfaces created in one turn are known
// when later turns update them.
package macros
