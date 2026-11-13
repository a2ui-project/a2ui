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

package v1

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// Extensions holds v1.0 vendor/application metadata extensions keyed by UAX #31 identifiers.
type Extensions map[string]any

// BuilderVersionFamily returns VersionFamily1_0.
func (Extensions) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// Validate checks that every extension key is a valid Unicode UAX #31 identifier.
func (e Extensions) Validate() error {
	for k := range e {
		if !core.IsValidUAX31Identifier(k) {
			return core.NewValidationErrorf("extension key %q must be a valid Unicode identifier (UAX #31)", k)
		}
	}
	return nil
}

// SerializeBuilderValue validates UAX #31 keys and serializes extension values.
func (e Extensions) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	out := make(map[string]any, len(e))
	for k, v := range e {
		ser, err := ctx.SerializeValue(v)
		if err != nil {
			return nil, err
		}
		out[k] = ser
	}
	return out, nil
}

// AccessibilityLive controls WAI-ARIA aria-live announcements on v1.0 components.
type AccessibilityLive string

const (
	AccessibilityLiveOff       AccessibilityLive = "off"
	AccessibilityLivePolite    AccessibilityLive = "polite"
	AccessibilityLiveAssertive AccessibilityLive = "assertive"
)

// EnumValues returns the allowed AccessibilityLive literals.
func (AccessibilityLive) EnumValues() []string {
	return []string{"off", "polite", "assertive"}
}

// AccessibilityAttributes configures assistive technology metadata on a v1.0 component.
type AccessibilityAttributes struct {
	Label       DynamicString
	Description DynamicString
	Live        AccessibilityLive
	Hidden      DynamicBoolean
}

// BuilderVersionFamily returns VersionFamily1_0.
func (AccessibilityAttributes) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily1_0
}

// SerializeBuilderValue converts non-empty accessibility attributes to a wire map.
func (a AccessibilityAttributes) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	out := make(map[string]any)
	if !builder.IsNilValue(a.Label) {
		v, err := a.Label.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["label"] = v
	}
	if !builder.IsNilValue(a.Description) {
		v, err := a.Description.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["description"] = v
	}
	if a.Live != "" {
		if err := ctx.ValidateEnum("AccessibilityAttributes.live", string(a.Live), a.Live); err != nil {
			return nil, err
		}
		out["live"] = string(a.Live)
	}
	if !builder.IsNilValue(a.Hidden) {
		v, err := a.Hidden.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["hidden"] = v
	}
	return out, nil
}

// CheckRule defines a renderer-evaluated validation rule on a checkable v1.0 component.
type CheckRule struct {
	Condition CheckCondition
	Message   string
}

// NewCheckRule constructs a v1.0 CheckRule with condition and optional fallback message.
func NewCheckRule(condition CheckCondition, message string) CheckRule {
	return CheckRule{Condition: condition, Message: message}
}

// BuilderVersionFamily returns VersionFamily1_0.
func (CheckRule) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue converts CheckRule into {"condition": ..., "message"?: ...}.
func (r CheckRule) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(r.Condition) {
		return nil, core.NewValidationError("CheckRule condition must not be nil")
	}
	cond, err := r.Condition.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"condition": cond,
	}
	if r.Message != "" {
		out["message"] = r.Message
	}
	return out, nil
}

// ActionEvent describes an agent-dispatched interaction event on a v1.0 Action.
type ActionEvent struct {
	Name        string
	UserMessage DynamicString
	Context     map[string]DynamicValue
}

// BuilderVersionFamily returns VersionFamily1_0.
func (ActionEvent) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue converts ActionEvent into {"name": ..., "userMessage"?: ..., "context"?: ...}.
func (e ActionEvent) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if e.Name == "" {
		return nil, core.NewValidationError("ActionEvent name must not be empty")
	}
	out := map[string]any{
		"name": e.Name,
	}
	if !builder.IsNilValue(e.UserMessage) {
		um, err := e.UserMessage.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["userMessage"] = um
	}
	if len(e.Context) > 0 {
		ctxMap := make(map[string]any, len(e.Context))
		for k, v := range e.Context {
			if builder.IsNilValue(v) {
				continue
			}
			ser, err := v.SerializeBuilderValue(ctx)
			if err != nil {
				return nil, err
			}
			ctxMap[k] = ser
		}
		if len(ctxMap) > 0 {
			out["context"] = ctxMap
		}
	}
	return out, nil
}

// Action dispatches either an agent Event or a FunctionCall (mutually exclusive).
type Action struct {
	Event        *ActionEvent
	FunctionCall *FunctionCall
}

// EventAction creates a v1.0 Action dispatching the named event with an optional context map (nil for none).
// Set ActionEvent fields such as UserMessage via a struct literal: Action{Event: &ActionEvent{...}}.
func EventAction(name string, context map[string]DynamicValue) Action {
	return Action{Event: &ActionEvent{Name: name, Context: context}}
}

// FunctionAction creates a v1.0 Action invoking fn.
func FunctionAction(fn FunctionCall) Action {
	return Action{FunctionCall: &fn}
}

// Validate ensures exactly one of Event or FunctionCall is set.
func (a Action) Validate() error {
	if (a.Event == nil) == (a.FunctionCall == nil) {
		return core.NewValidationError("Action requires exactly one of 'event' or 'functionCall'")
	}
	return nil
}

// BuilderVersionFamily returns VersionFamily1_0.
func (Action) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue validates mutual exclusivity and emits {"event": ...} or {"functionCall": ...}.
func (a Action) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if err := a.Validate(); err != nil {
		return nil, err
	}
	if a.Event != nil {
		ev, err := a.Event.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{"event": ev}, nil
	}
	fc, err := a.FunctionCall.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"functionCall": fc}, nil
}

// ComponentNode is embedded by all v1.0 component builders (including user-defined custom components)
// to provide ID, catalogId, accessibility, and metadata.extensions envelope fields.
type ComponentNode struct {
	// Component optionally sets the wire component name on custom struct nodes that do not override ComponentType().
	Component     string
	ID            string
	CatalogID     string
	Accessibility *AccessibilityAttributes
	Extensions    Extensions
}

// ComponentType returns Component (custom structs typically override ComponentType with a constant).
func (n ComponentNode) ComponentType() string { return n.Component }

// ComponentID returns the explicit author-assigned component ID, if any.
func (n ComponentNode) ComponentID() string { return n.ID }

// BuilderVersionFamily returns VersionFamily1_0.
func (n ComponentNode) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SetExtension validates key as a UAX #31 identifier and sets value on Extensions.
func (n *ComponentNode) SetExtension(key string, value any) error {
	if !core.IsValidUAX31Identifier(key) {
		return core.NewValidationErrorf("extension key %q must be a valid Unicode identifier (UAX #31)", key)
	}
	if n.Extensions == nil {
		n.Extensions = make(Extensions)
	}
	n.Extensions[key] = value
	return nil
}

// SerializeEnvelopeAttributes writes catalogId, accessibility, and metadata.extensions into dst
// under the v1.0 @catalogId, @accessibility, and @metadata keys.
func (n ComponentNode) SerializeEnvelopeAttributes(ctx *builder.FlattenContext, dst map[string]any, defaultCatalogID string) error {
	cid := n.CatalogID
	if cid == "" {
		cid = defaultCatalogID
	}
	if cid != "" {
		dst["@catalogId"] = cid
	}
	if n.Accessibility != nil {
		a11y, err := n.Accessibility.SerializeBuilderValue(ctx)
		if err != nil {
			return err
		}
		dst["@accessibility"] = a11y
	}
	if n.Extensions != nil {
		extVal, err := n.Extensions.SerializeBuilderValue(ctx)
		if err != nil {
			return err
		}
		dst["@metadata"] = map[string]any{"extensions": extVal}
	}
	return nil
}

func setWeight(out map[string]any, field string, w *float64) error {
	if w == nil {
		return nil
	}
	if err := builder.ValidateFiniteFloat(field, *w); err != nil {
		return err
	}
	out["weight"] = *w
	return nil
}
