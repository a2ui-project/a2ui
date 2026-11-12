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

// Package v1 provides typed builders for A2UI v1.0 components, functions, data
// bindings, actions and message envelopes.
//
// Every Basic Catalog component has a constructor that takes its required
// properties and fills in catalog defaults, plus chainable With* setters for the
// optional ones:
//
//	card := v1.NewCard(v1.NewColumn(v1.Children(
//		v1.NewText(v1.Str("Hello")).WithVariant(v1.TextVariantH2),
//		v1.NewButton(v1.NewText(v1.Str("Save")), v1.EventAction("save", nil)),
//	)))
//
// Component fields are exported, so a struct literal such as
// &v1.Text{Text: v1.Str("Hi")} works too; optional fields left unset fall back to
// the catalog defaults. Use pointers: the flattener tracks shared nodes by
// pointer identity.
//
// Dynamic properties accept literals (Str, Num, Bool), data bindings (Bind) and
// function calls (FormatString, Required, Email and the rest of the Basic Catalog
// functions). Custom catalog components embed ComponentNode to get the id,
// catalogId, accessibility and metadata.extensions envelope fields. Those fields,
// and the Checks of checkable components, serialize under the @-prefixed v1.0 wire
// keys @catalogId, @accessibility, @metadata and @checks.
//
// UpdateComponentsFromTree flattens a tree into an updateComponents message;
// CreateSurface, UpdateDataModel and DeleteSurface build the other envelopes.
package v1
