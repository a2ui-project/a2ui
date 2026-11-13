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

package v09

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// AccessibilityAttributes configures assistive technology metadata on a v0.9 component.
type AccessibilityAttributes struct {
	Label       DynamicString
	Description DynamicString
}

// BuilderVersionFamily returns VersionFamily0_9.
func (AccessibilityAttributes) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily0_9
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
	return out, nil
}

// CheckRule defines a client-side validation rule on a checkable v0.9 component.
type CheckRule struct {
	Condition DynamicBoolean
	Message   string
}

// NewCheckRule constructs a v0.9 CheckRule with required condition and error message.
func NewCheckRule(condition DynamicBoolean, message string) CheckRule {
	return CheckRule{Condition: condition, Message: message}
}

// BuilderVersionFamily returns VersionFamily0_9.
func (CheckRule) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue converts CheckRule into {"condition": ..., "message": ...}.
func (r CheckRule) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(r.Condition) {
		return nil, core.NewValidationError("CheckRule condition must not be nil")
	}
	if r.Message == "" {
		return nil, core.NewValidationError("v0.9 CheckRule message must not be empty")
	}
	cond, err := r.Condition.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"condition": cond,
		"message":   r.Message,
	}, nil
}

// ActionEvent describes a server-dispatched interaction event on a v0.9 Action.
type ActionEvent struct {
	Name    string
	Context map[string]DynamicValue
}

// BuilderVersionFamily returns VersionFamily0_9.
func (ActionEvent) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue converts ActionEvent into {"name": ..., "context"?: ...}.
func (e ActionEvent) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if e.Name == "" {
		return nil, core.NewValidationError("ActionEvent name must not be empty")
	}
	out := map[string]any{
		"name": e.Name,
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

// Action dispatches either a server Event or a client FunctionCall (mutually exclusive).
type Action struct {
	Event        *ActionEvent
	FunctionCall *FunctionCall
}

// EventAction creates a v0.9 Action dispatching the named event with an optional context map (nil for none).
// Set ActionEvent fields such as UserMessage via a struct literal: Action{Event: &ActionEvent{...}}.
func EventAction(name string, context map[string]DynamicValue) Action {
	return Action{Event: &ActionEvent{Name: name, Context: context}}
}

// FunctionAction creates a v0.9 Action invoking fn.
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

// BuilderVersionFamily returns VersionFamily0_9.
func (Action) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

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

// ComponentNode is embedded by all v0.9 component builders (including user-defined custom components)
// to provide ID and accessibility envelope fields.
type ComponentNode struct {
	Component     string
	ID            string
	Accessibility *AccessibilityAttributes
}

// ComponentType returns Component (custom structs typically override ComponentType with a constant).
func (n ComponentNode) ComponentType() string { return n.Component }

// ComponentID returns the explicit author-assigned component ID, if any.
func (n ComponentNode) ComponentID() string { return n.ID }

// BuilderVersionFamily returns VersionFamily0_9.
func (n ComponentNode) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeEnvelopeAttributes writes accessibility into dst when present.
func (n ComponentNode) SerializeEnvelopeAttributes(ctx *builder.FlattenContext, dst map[string]any, _ string) error {
	if n.Accessibility != nil {
		a11y, err := n.Accessibility.SerializeBuilderValue(ctx)
		if err != nil {
			return err
		}
		dst["accessibility"] = a11y
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
