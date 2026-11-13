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

// Package builder turns nested A2UI component trees into the flat component lists
// that A2UI messages carry.
//
// Authors build trees with the typed constructors in the version packages
// (builder/v1 for v1.0, builder/v09 for v0.9 and v0.9.1). This package holds the
// version-neutral parts: the Node interface, ComponentRef, and the flattener.
//
// # Flattening
//
// FlattenComponentTree walks a tree in two passes. Pass 1 reserves every
// author-supplied ID and rejects cycles and duplicate IDs. Pass 2 assigns the rest
// deterministic IDs of the form "{rootID}__{component}_{n}" (for example
// "root__text_1") and emits children before their parents, so a renderer can
// resolve every child reference as it streams in. The root keeps rootID itself.
//
// A node reached twice through the same pointer is emitted once and referenced
// from both places. A ComponentRef names a component already on the surface; it
// is never emitted or renamed.
//
// # Custom components
//
// Any pointer type that implements Node can join a tree. Implement
// ComponentSerializer to control its wire properties; otherwise exported struct
// fields are serialized by reflection.
package builder
