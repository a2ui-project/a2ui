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

// TabItem defines a single tab with a Title and Child component inside Tabs.
type TabItem struct {
	Title DynamicString `json:"title"`
	Child builder.Node  `json:"child"`
}

// NewTabItem constructs a v0.9 TabItem.
func NewTabItem(title DynamicString, child builder.Node) TabItem {
	return TabItem{Title: title, Child: child}
}

// BuilderVersionFamily returns VersionFamily0_9.
func (TabItem) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue resolves Child to its component ID and emits {"title": ..., "child": id}.
func (t TabItem) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(t.Title) {
		return nil, core.NewValidationError("TabItem.Title is required")
	}
	if builder.IsNilValue(t.Child) {
		return nil, core.NewValidationError("TabItem.Child is required")
	}
	titleVal, err := t.Title.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	childID, err := ctx.EmitChild(t.Child)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"title": titleVal,
		"child": childID,
	}, nil
}

// Row builds a v0.9 Basic Catalog horizontal flex layout component.
type Row struct {
	ComponentNode
	Children ChildList
	Justify  FlexJustify
	Align    FlexAlign
	Weight   *float64
}

// NewRow constructs a v0.9 Row component.
func NewRow(children ChildList) *Row {
	return &Row{Children: children, Justify: FlexJustifyStart, Align: FlexAlignStretch}
}

// ComponentType returns "Row".
func (*Row) ComponentType() string { return "Row" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Row) WithID(id string) *Row { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Row) WithAccessibility(a AccessibilityAttributes) *Row {
	c.Accessibility = &a
	return c
}

// WithJustify sets the justify property and returns c.
func (c *Row) WithJustify(j FlexJustify) *Row { c.Justify = j; return c }

// WithAlign sets the align property and returns c.
func (c *Row) WithAlign(a FlexAlign) *Row { c.Align = a; return c }

// WithWeight sets the weight property and returns c.
func (c *Row) WithWeight(w float64) *Row { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Row) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Row) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Children) {
		return nil, core.NewValidationError("Row.Children is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	ch, err := c.Children.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["children"] = ch
	justify := c.Justify
	if justify == "" {
		justify = FlexJustifyStart
	}
	if err := ctx.ValidateEnum("Row.justify", string(justify), justify); err != nil {
		return nil, err
	}
	out["justify"] = string(justify)
	align := c.Align
	if align == "" {
		align = FlexAlignStretch
	}
	if err := ctx.ValidateEnum("Row.align", string(align), align); err != nil {
		return nil, err
	}
	out["align"] = string(align)
	if err := setWeight(out, "Row.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Column builds a v0.9 Basic Catalog vertical flex layout component.
type Column struct {
	ComponentNode
	Children ChildList
	Justify  FlexJustify
	Align    FlexAlign
	Weight   *float64
}

// NewColumn constructs a v0.9 Column component.
func NewColumn(children ChildList) *Column {
	return &Column{Children: children, Justify: FlexJustifyStart, Align: FlexAlignStretch}
}

// ComponentType returns "Column".
func (*Column) ComponentType() string { return "Column" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Column) WithID(id string) *Column { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Column) WithAccessibility(a AccessibilityAttributes) *Column {
	c.Accessibility = &a
	return c
}

// WithJustify sets the justify property and returns c.
func (c *Column) WithJustify(j FlexJustify) *Column { c.Justify = j; return c }

// WithAlign sets the align property and returns c.
func (c *Column) WithAlign(a FlexAlign) *Column { c.Align = a; return c }

// WithWeight sets the weight property and returns c.
func (c *Column) WithWeight(w float64) *Column { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Column) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Column) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Children) {
		return nil, core.NewValidationError("Column.Children is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	ch, err := c.Children.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["children"] = ch
	justify := c.Justify
	if justify == "" {
		justify = FlexJustifyStart
	}
	if err := ctx.ValidateEnum("Column.justify", string(justify), justify); err != nil {
		return nil, err
	}
	out["justify"] = string(justify)
	align := c.Align
	if align == "" {
		align = FlexAlignStretch
	}
	if err := ctx.ValidateEnum("Column.align", string(align), align); err != nil {
		return nil, err
	}
	out["align"] = string(align)
	if err := setWeight(out, "Column.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// List builds a v0.9 Basic Catalog scrollable List component.
type List struct {
	ComponentNode
	Children  ChildList
	Direction ListDirection
	Align     ListAlign
	Weight    *float64
}

// NewList constructs a v0.9 List component.
func NewList(children ChildList) *List {
	return &List{Children: children, Direction: ListDirectionVertical, Align: ListAlignStretch}
}

// ComponentType returns "List".
func (*List) ComponentType() string { return "List" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *List) WithID(id string) *List { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *List) WithAccessibility(a AccessibilityAttributes) *List {
	c.Accessibility = &a
	return c
}

// WithDirection sets the direction property and returns c.
func (c *List) WithDirection(d ListDirection) *List { c.Direction = d; return c }

// WithAlign sets the align property and returns c.
func (c *List) WithAlign(a ListAlign) *List { c.Align = a; return c }

// WithWeight sets the weight property and returns c.
func (c *List) WithWeight(w float64) *List { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *List) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *List) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Children) {
		return nil, core.NewValidationError("List.Children is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	ch, err := c.Children.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["children"] = ch
	dir := c.Direction
	if dir == "" {
		dir = ListDirectionVertical
	}
	if err := ctx.ValidateEnum("List.direction", string(dir), dir); err != nil {
		return nil, err
	}
	out["direction"] = string(dir)
	align := c.Align
	if align == "" {
		align = ListAlignStretch
	}
	if err := ctx.ValidateEnum("List.align", string(align), align); err != nil {
		return nil, err
	}
	out["align"] = string(align)
	if err := setWeight(out, "List.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Card builds a v0.9 Basic Catalog Card container component.
type Card struct {
	ComponentNode
	Child  builder.Node
	Weight *float64
}

// NewCard constructs a v0.9 Card component.
func NewCard(child builder.Node) *Card {
	return &Card{Child: child}
}

// ComponentType returns "Card".
func (*Card) ComponentType() string { return "Card" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Card) WithID(id string) *Card { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Card) WithAccessibility(a AccessibilityAttributes) *Card {
	c.Accessibility = &a
	return c
}

// WithWeight sets the weight property and returns c.
func (c *Card) WithWeight(w float64) *Card { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Card) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Card) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Child) {
		return nil, core.NewValidationError("Card.Child is required")
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
	if err := setWeight(out, "Card.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Tabs builds a v0.9 Basic Catalog Tabs component.
type Tabs struct {
	ComponentNode
	Tabs   []TabItem
	Weight *float64
}

// NewTabs constructs a v0.9 Tabs component.
func NewTabs(tabs ...TabItem) *Tabs {
	if tabs == nil {
		tabs = []TabItem{}
	}
	return &Tabs{Tabs: tabs}
}

// ComponentType returns "Tabs".
func (*Tabs) ComponentType() string { return "Tabs" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Tabs) WithID(id string) *Tabs { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Tabs) WithAccessibility(a AccessibilityAttributes) *Tabs {
	c.Accessibility = &a
	return c
}

// WithWeight sets the weight property and returns c.
func (c *Tabs) WithWeight(w float64) *Tabs { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Tabs) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Tabs) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if c.Tabs == nil {
		return nil, core.NewValidationError("Tabs.Tabs is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	items := make([]any, 0, len(c.Tabs))
	for _, item := range c.Tabs {
		ser, err := item.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		items = append(items, ser)
	}
	out["tabs"] = items
	if err := setWeight(out, "Tabs.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Modal builds a v0.9 Basic Catalog Modal component.
type Modal struct {
	ComponentNode
	Trigger builder.Node
	Content builder.Node
	Weight  *float64
}

// NewModal constructs a v0.9 Modal component with trigger and content slots.
func NewModal(trigger, content builder.Node) *Modal {
	return &Modal{Trigger: trigger, Content: content}
}

// ComponentType returns "Modal".
func (*Modal) ComponentType() string { return "Modal" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Modal) WithID(id string) *Modal { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Modal) WithAccessibility(a AccessibilityAttributes) *Modal {
	c.Accessibility = &a
	return c
}

// WithWeight sets the weight property and returns c.
func (c *Modal) WithWeight(w float64) *Modal { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Modal) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Modal) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Trigger) {
		return nil, core.NewValidationError("Modal.Trigger is required")
	}
	if builder.IsNilValue(c.Content) {
		return nil, core.NewValidationError("Modal.Content is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	trigID, err := ctx.EmitChild(c.Trigger)
	if err != nil {
		return nil, err
	}
	contID, err := ctx.EmitChild(c.Content)
	if err != nil {
		return nil, err
	}
	out["trigger"] = trigID
	out["content"] = contID
	if err := setWeight(out, "Modal.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Divider builds a v0.9 Basic Catalog Divider component.
type Divider struct {
	ComponentNode
	Axis   DividerAxis
	Weight *float64
}

// NewDivider constructs a v0.9 Divider component defaulting to horizontal axis.
func NewDivider() *Divider {
	return &Divider{Axis: DividerAxisHorizontal}
}

// ComponentType returns "Divider".
func (*Divider) ComponentType() string { return "Divider" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Divider) WithID(id string) *Divider { c.ID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Divider) WithAccessibility(a AccessibilityAttributes) *Divider {
	c.Accessibility = &a
	return c
}

// WithAxis sets the axis property and returns c.
func (c *Divider) WithAxis(a DividerAxis) *Divider { c.Axis = a; return c }

// WithWeight sets the weight property and returns c.
func (c *Divider) WithWeight(w float64) *Divider { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Divider) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Divider) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	axis := c.Axis
	if axis == "" {
		axis = DividerAxisHorizontal
	}
	if err := ctx.ValidateEnum("Divider.axis", string(axis), axis); err != nil {
		return nil, err
	}
	out["axis"] = string(axis)
	if err := setWeight(out, "Divider.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}
