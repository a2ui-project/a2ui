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

// VersionFamily identifies the protocol family targeted by a builder node or model.
type VersionFamily string

const (
	// VersionFamilyUnspecified indicates a version-neutral construct such as ComponentRef.
	VersionFamilyUnspecified VersionFamily = ""
	// VersionFamily0_9 identifies A2UI v0.9 and v0.9.1 builder constructs.
	VersionFamily0_9 VersionFamily = "0.9"
	// VersionFamily1_0 identifies A2UI v1.0 builder constructs.
	VersionFamily1_0 VersionFamily = "1.0"
)

// Node is implemented by all component builder nodes and ComponentRef slots.
type Node interface {
	ComponentType() string
	ComponentID() string
	BuilderVersionFamily() VersionFamily
}

// ComponentSerializer may be implemented by a Node to customize wire-property serialization.
// Nodes that do not implement ComponentSerializer are serialized via struct field reflection.
type ComponentSerializer interface {
	Node
	SerializeComponent(ctx *FlattenContext) (map[string]any, error)
}

// ValueSerializer converts a typed builder value (such as DataBinding, FunctionCall, Action,
// DynamicChildList, CheckRule, or AccessibilityAttributes) into its wire JSON representation.
type ValueSerializer interface {
	SerializeBuilderValue(ctx *FlattenContext) (any, error)
}

// VersionedModel may be implemented by non-Node builder models to advertise their protocol family.
type VersionedModel interface {
	BuilderVersionFamily() VersionFamily
}

// StringEnum is implemented by typed catalog enum strings so builders can validate authoring
// values and macro synthesizers can extract allowed JSON Schema enum literals.
type StringEnum interface {
	EnumValues() []string
}

// EnvelopeAttributeCarrier exposes optional component envelope properties on custom struct nodes.
type EnvelopeAttributeCarrier interface {
	SerializeEnvelopeAttributes(ctx *FlattenContext, dst map[string]any, defaultCatalogID string) error
}

// DefaultCatalogIDProvider may be implemented by custom component structs to bind a default catalogId.
type DefaultCatalogIDProvider interface {
	DefaultCatalogID() string
}

// ComponentRef references an existing component on the surface by ID without emitting or namespacing it.
type ComponentRef struct {
	ID string
}

// NewComponentRef constructs a slot boundary reference to an existing component ID on the surface.
func NewComponentRef(id string) *ComponentRef {
	return &ComponentRef{ID: id}
}

// ComponentType returns an empty string because ComponentRef is a reference, not a component definition.
func (r *ComponentRef) ComponentType() string { return "" }

// ComponentID returns the referenced surface component ID verbatim.
func (r *ComponentRef) ComponentID() string {
	if r == nil {
		return ""
	}
	return r.ID
}

// BuilderVersionFamily returns VersionFamilyUnspecified so ComponentRef works across all protocol versions.
func (r *ComponentRef) BuilderVersionFamily() VersionFamily { return VersionFamilyUnspecified }

// ComponentRefID returns the referenced component ID and true when node is a *ComponentRef.
func ComponentRefID(node Node) (string, bool) {
	ref, ok := node.(*ComponentRef)
	if !ok {
		return "", false
	}
	return ref.ComponentID(), true
}
