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

package builder

import (
	"encoding/json"

	"github.com/a2ui-project/a2ui/go/core"
)

// ComponentTree pairs a root builder Node with an optional target SurfaceID.
type ComponentTree struct {
	Root      Node
	SurfaceID string
}

// NewComponentTree constructs a transport-agnostic ComponentTree container.
func NewComponentTree(root Node, surfaceID string) *ComponentTree {
	return &ComponentTree{
		Root:      root,
		SurfaceID: surfaceID,
	}
}

// Flatten serializes the primary tree into flat post-order component maps,
// defaulting the root ID to Root.ComponentID() or "root".
func (t *ComponentTree) Flatten() ([]map[string]any, error) {
	if t == nil {
		return nil, core.NewValidationError("ComponentTree must not be nil")
	}
	rootID := ""
	if !isNilNode(t.Root) {
		rootID = t.Root.ComponentID()
	}
	if rootID == "" {
		rootID = "root"
	}
	return FlattenComponentTree(t.Root, rootID)
}

// MarshalJSON implements json.Marshaler by encoding the flattened post-order component list.
func (t *ComponentTree) MarshalJSON() ([]byte, error) {
	flat, err := t.Flatten()
	if err != nil {
		return nil, err
	}
	return json.Marshal(flat)
}
