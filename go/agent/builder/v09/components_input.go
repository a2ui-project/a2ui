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

// ChoicePickerOption defines an option entry inside a ChoicePicker component.
type ChoicePickerOption struct {
	Label DynamicString `json:"label"`
	Value string        `json:"value"`
}

// NewChoicePickerOption constructs a v0.9 ChoicePickerOption.
func NewChoicePickerOption(label DynamicString, value string) ChoicePickerOption {
	return ChoicePickerOption{Label: label, Value: value}
}

// BuilderVersionFamily returns VersionFamily0_9.
func (ChoicePickerOption) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily0_9
}

// SerializeBuilderValue emits {"label": ..., "value": ...}.
func (o ChoicePickerOption) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(o.Label) {
		return nil, core.NewValidationError("ChoicePickerOption.Label is required")
	}
	lbl, err := o.Label.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"label": lbl,
		"value": o.Value,
	}, nil
}

func serializeChecks(ctx *builder.FlattenContext, checks []CheckRule) ([]any, error) {
	out := make([]any, 0, len(checks))
	for _, chk := range checks {
		ser, err := chk.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out = append(out, ser)
	}
	return out, nil
}

// Button builds a v0.9 Basic Catalog Button component.
type Button struct {
	ComponentNode
	Child   builder.Node
	Variant ButtonVariant
	Action  Action
	Weight  *float64
	Checks  []CheckRule
}

// NewButton constructs a v0.9 Button component with child slot and interaction action.
func NewButton(child builder.Node, action Action) *Button {
	return &Button{Child: child, Action: action, Variant: ButtonVariantDefault}
}

// ComponentType returns "Button".
func (*Button) ComponentType() string { return "Button" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Button) WithID(id string) *Button { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Button) WithAccessibility(a AccessibilityAttributes) *Button {
	c.Accessibility = &a
	return c
}

// WithVariant sets the variant property and returns c.
func (c *Button) WithVariant(v ButtonVariant) *Button { c.Variant = v; return c }

// WithWeight sets the weight property and returns c.
func (c *Button) WithWeight(w float64) *Button { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *Button) WithChecks(checks ...CheckRule) *Button {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Button) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Button) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Child) {
		return nil, core.NewValidationError("Button.Child is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	childID, err := ctx.EmitChild(c.Child)
	if err != nil {
		return nil, err
	}
	out["child"] = childID
	variant := c.Variant
	if variant == "" {
		variant = ButtonVariantDefault
	}
	if err := ctx.ValidateEnum("Button.variant", string(variant), variant); err != nil {
		return nil, err
	}
	out["variant"] = string(variant)
	act, err := c.Action.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["action"] = act
	if err := setWeight(out, "Button.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}

// TextField builds a v0.9 Basic Catalog TextField input component.
type TextField struct {
	ComponentNode
	Label            DynamicString
	Value            DynamicString
	Variant          TextFieldVariant
	ValidationRegexp *string
	Weight           *float64
	Checks           []CheckRule
}

// NewTextField constructs a v0.9 TextField component with required label.
func NewTextField(label DynamicString) *TextField {
	return &TextField{Label: label, Variant: TextFieldVariantShortText}
}

// ComponentType returns "TextField".
func (*TextField) ComponentType() string { return "TextField" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *TextField) WithID(id string) *TextField { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *TextField) WithAccessibility(a AccessibilityAttributes) *TextField {
	c.Accessibility = &a
	return c
}

// WithValue sets the value property and returns c.
func (c *TextField) WithValue(v DynamicString) *TextField { c.Value = v; return c }

// WithVariant sets the variant property and returns c.
func (c *TextField) WithVariant(v TextFieldVariant) *TextField { c.Variant = v; return c }

// WithValidationRegexp sets the validation regexp property and returns c.
func (c *TextField) WithValidationRegexp(re string) *TextField {
	c.ValidationRegexp = &re
	return c
}

// WithWeight sets the weight property and returns c.
func (c *TextField) WithWeight(w float64) *TextField { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *TextField) WithChecks(checks ...CheckRule) *TextField {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *TextField) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *TextField) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Label) {
		return nil, core.NewValidationError("TextField.Label is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	lbl, err := c.Label.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["label"] = lbl
	if !builder.IsNilValue(c.Value) {
		val, err := c.Value.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["value"] = val
	}
	variant := c.Variant
	if variant == "" {
		variant = TextFieldVariantShortText
	}
	if err := ctx.ValidateEnum("TextField.variant", string(variant), variant); err != nil {
		return nil, err
	}
	out["variant"] = string(variant)
	if c.ValidationRegexp != nil {
		out["validationRegexp"] = *c.ValidationRegexp
	}
	if err := setWeight(out, "TextField.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}

// CheckBox builds a v0.9 Basic Catalog CheckBox input component.
type CheckBox struct {
	ComponentNode
	Label  DynamicString
	Value  DynamicBoolean
	Weight *float64
	Checks []CheckRule
}

// NewCheckBox constructs a v0.9 CheckBox component.
func NewCheckBox(label DynamicString, value DynamicBoolean) *CheckBox {
	return &CheckBox{Label: label, Value: value}
}

// ComponentType returns "CheckBox".
func (*CheckBox) ComponentType() string { return "CheckBox" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *CheckBox) WithID(id string) *CheckBox { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *CheckBox) WithAccessibility(a AccessibilityAttributes) *CheckBox {
	c.Accessibility = &a
	return c
}

// WithWeight sets the weight property and returns c.
func (c *CheckBox) WithWeight(w float64) *CheckBox { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *CheckBox) WithChecks(checks ...CheckRule) *CheckBox {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *CheckBox) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *CheckBox) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Label) {
		return nil, core.NewValidationError("CheckBox.Label is required")
	}
	if builder.IsNilValue(c.Value) {
		return nil, core.NewValidationError("CheckBox.Value is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	lbl, err := c.Label.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	val, err := c.Value.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["label"] = lbl
	out["value"] = val
	if err := setWeight(out, "CheckBox.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}

// ChoicePicker builds a v0.9 Basic Catalog ChoicePicker component.
type ChoicePicker struct {
	ComponentNode
	Label        DynamicString
	Variant      ChoicePickerVariant
	Options      []ChoicePickerOption
	Value        DynamicStringList
	DisplayStyle ChoicePickerDisplayStyle
	Filterable   *bool
	Weight       *float64
	Checks       []CheckRule
}

// NewChoicePicker constructs a v0.9 ChoicePicker component.
func NewChoicePicker(options []ChoicePickerOption, value DynamicStringList) *ChoicePicker {
	if options == nil {
		options = []ChoicePickerOption{}
	}
	f := false
	return &ChoicePicker{
		Options:      options,
		Value:        value,
		Variant:      ChoicePickerVariantMutuallyExclusive,
		DisplayStyle: ChoicePickerDisplayCheckbox,
		Filterable:   &f,
	}
}

// ComponentType returns "ChoicePicker".
func (*ChoicePicker) ComponentType() string { return "ChoicePicker" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *ChoicePicker) WithID(id string) *ChoicePicker { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *ChoicePicker) WithAccessibility(a AccessibilityAttributes) *ChoicePicker {
	c.Accessibility = &a
	return c
}

// WithLabel sets the label property and returns c.
func (c *ChoicePicker) WithLabel(l DynamicString) *ChoicePicker { c.Label = l; return c }

// WithVariant sets the variant property and returns c.
func (c *ChoicePicker) WithVariant(v ChoicePickerVariant) *ChoicePicker { c.Variant = v; return c }

// WithDisplayStyle sets the display style property and returns c.
func (c *ChoicePicker) WithDisplayStyle(d ChoicePickerDisplayStyle) *ChoicePicker {
	c.DisplayStyle = d
	return c
}

// WithFilterable sets the filterable property and returns c.
func (c *ChoicePicker) WithFilterable(f bool) *ChoicePicker { c.Filterable = &f; return c }

// WithWeight sets the weight property and returns c.
func (c *ChoicePicker) WithWeight(w float64) *ChoicePicker { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *ChoicePicker) WithChecks(checks ...CheckRule) *ChoicePicker {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *ChoicePicker) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *ChoicePicker) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if c.Options == nil {
		return nil, core.NewValidationError("ChoicePicker.Options is required")
	}
	if builder.IsNilValue(c.Value) {
		return nil, core.NewValidationError("ChoicePicker.Value is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	if !builder.IsNilValue(c.Label) {
		lbl, err := c.Label.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["label"] = lbl
	}
	variant := c.Variant
	if variant == "" {
		variant = ChoicePickerVariantMutuallyExclusive
	}
	if err := ctx.ValidateEnum("ChoicePicker.variant", string(variant), variant); err != nil {
		return nil, err
	}
	out["variant"] = string(variant)
	opts := make([]any, 0, len(c.Options))
	for _, opt := range c.Options {
		ser, err := opt.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		opts = append(opts, ser)
	}
	out["options"] = opts
	val, err := c.Value.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["value"] = val
	ds := c.DisplayStyle
	if ds == "" {
		ds = ChoicePickerDisplayCheckbox
	}
	if err := ctx.ValidateEnum("ChoicePicker.displayStyle", string(ds), ds); err != nil {
		return nil, err
	}
	out["displayStyle"] = string(ds)
	filterable := false
	if c.Filterable != nil {
		filterable = *c.Filterable
	}
	out["filterable"] = filterable
	if err := setWeight(out, "ChoicePicker.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}

// Slider builds a v0.9 Basic Catalog Slider component.
type Slider struct {
	ComponentNode
	Label  DynamicString
	Min    *float64
	Max    float64
	Value  DynamicNumber
	Weight *float64
	Checks []CheckRule
}

// NewSlider constructs a v0.9 Slider component with max bound and value.
func NewSlider(max float64, value DynamicNumber) *Slider {
	min := 0.0
	return &Slider{Min: &min, Max: max, Value: value}
}

// ComponentType returns "Slider".
func (*Slider) ComponentType() string { return "Slider" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Slider) WithID(id string) *Slider { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Slider) WithAccessibility(a AccessibilityAttributes) *Slider {
	c.Accessibility = &a
	return c
}

// WithLabel sets the label property and returns c.
func (c *Slider) WithLabel(l DynamicString) *Slider { c.Label = l; return c }

// WithMin sets the min property and returns c.
func (c *Slider) WithMin(m float64) *Slider { c.Min = &m; return c }

// WithWeight sets the weight property and returns c.
func (c *Slider) WithWeight(w float64) *Slider { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *Slider) WithChecks(checks ...CheckRule) *Slider {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Slider) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Slider) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Value) {
		return nil, core.NewValidationError("Slider.Value is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	if !builder.IsNilValue(c.Label) {
		lbl, err := c.Label.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["label"] = lbl
	}
	minVal := 0.0
	if c.Min != nil {
		minVal = *c.Min
	}
	if err := builder.ValidateFiniteFloat("Slider.min", minVal); err != nil {
		return nil, err
	}
	if err := builder.ValidateFiniteFloat("Slider.max", c.Max); err != nil {
		return nil, err
	}
	out["min"] = minVal
	out["max"] = c.Max
	val, err := c.Value.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["value"] = val
	if err := setWeight(out, "Slider.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}

// DateTimeInput builds a v0.9 Basic Catalog DateTimeInput component.
type DateTimeInput struct {
	ComponentNode
	Value      DynamicString
	EnableDate *bool
	EnableTime *bool
	Min        any
	Max        any
	Label      DynamicString
	Weight     *float64
	Checks     []CheckRule
}

// NewDateTimeInput constructs a v0.9 DateTimeInput component.
func NewDateTimeInput(value DynamicString) *DateTimeInput {
	ed, et := false, false
	return &DateTimeInput{Value: value, EnableDate: &ed, EnableTime: &et}
}

// ComponentType returns "DateTimeInput".
func (*DateTimeInput) ComponentType() string { return "DateTimeInput" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *DateTimeInput) WithID(id string) *DateTimeInput { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *DateTimeInput) WithAccessibility(a AccessibilityAttributes) *DateTimeInput {
	c.Accessibility = &a
	return c
}

// WithEnableDate sets the enable date property and returns c.
func (c *DateTimeInput) WithEnableDate(b bool) *DateTimeInput { c.EnableDate = &b; return c }

// WithEnableTime sets the enable time property and returns c.
func (c *DateTimeInput) WithEnableTime(b bool) *DateTimeInput { c.EnableTime = &b; return c }

// WithMin sets the min property and returns c.
func (c *DateTimeInput) WithMin(m any) *DateTimeInput { c.Min = m; return c }

// WithMax sets the max property and returns c.
func (c *DateTimeInput) WithMax(m any) *DateTimeInput { c.Max = m; return c }

// WithLabel sets the label property and returns c.
func (c *DateTimeInput) WithLabel(l DynamicString) *DateTimeInput { c.Label = l; return c }

// WithWeight sets the weight property and returns c.
func (c *DateTimeInput) WithWeight(w float64) *DateTimeInput { c.Weight = &w; return c }

// WithChecks sets the validation check rules and returns c.
func (c *DateTimeInput) WithChecks(checks ...CheckRule) *DateTimeInput {
	if checks == nil {
		c.Checks = []CheckRule{}
	} else {
		c.Checks = checks
	}
	return c
}

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *DateTimeInput) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *DateTimeInput) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Value) {
		return nil, core.NewValidationError("DateTimeInput.Value is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	val, err := c.Value.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["value"] = val
	enableDate := false
	if c.EnableDate != nil {
		enableDate = *c.EnableDate
	}
	enableTime := false
	if c.EnableTime != nil {
		enableTime = *c.EnableTime
	}
	out["enableDate"] = enableDate
	out["enableTime"] = enableTime
	if !builder.IsNilValue(c.Min) {
		mv, err := ctx.SerializeValue(c.Min)
		if err != nil {
			return nil, err
		}
		if mv != nil {
			out["min"] = mv
		}
	}
	if !builder.IsNilValue(c.Max) {
		mv, err := ctx.SerializeValue(c.Max)
		if err != nil {
			return nil, err
		}
		if mv != nil {
			out["max"] = mv
		}
	}
	if !builder.IsNilValue(c.Label) {
		lbl, err := c.Label.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["label"] = lbl
	}
	if err := setWeight(out, "DateTimeInput.weight", c.Weight); err != nil {
		return nil, err
	}
	if c.Checks != nil {
		chks, err := serializeChecks(ctx, c.Checks)
		if err != nil {
			return nil, err
		}
		out["checks"] = chks
	}
	return out, nil
}
