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

// Package v09 provides typed builders for A2UI v0.9 and v0.9.1 components,
// functions, data bindings, actions and message envelopes.
//
// It mirrors package v1: each Basic Catalog component has a constructor for its
// required properties plus chainable With* setters, function builders return
// FunctionCall values, and UpdateComponentsFromTree flattens a tree into an
// updateComponents message:
//
//	card := v09.NewCard(v09.NewColumn(v09.Children(
//		v09.NewText(v09.Bind("/user/name")).WithVariant(v09.TextVariantH2),
//		v09.NewButton(v09.NewText(v09.Str("Open")), v09.EventAction("open", nil)),
//	)))
//
// The differences follow the protocol: data bindings serialize as {"path": ...},
// createSurface requires a catalogId, and components have no metadata.extensions.
package v09
