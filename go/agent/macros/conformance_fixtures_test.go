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

package macros_test

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/macros"
	"github.com/a2ui-project/a2ui/go/core"
)

// --- Custom Builder Structs for Mixed-Catalog Conformance ---

type fooCatalogBase struct{ v1.ComponentNode }

func (fooCatalogBase) DefaultCatalogID() string { return fooCID }

type barCatalogBase struct{ v1.ComponentNode }

func (barCatalogBase) DefaultCatalogID() string { return barCID }

type fooPanelNode struct {
	fooCatalogBase
	Children v1.ChildList `json:"children"`
}

func (fooPanelNode) ComponentType() string { return "FooPanel" }

type fooHeaderNode struct {
	fooCatalogBase
	Title v1.DynamicString `json:"title"`
}

func (fooHeaderNode) ComponentType() string { return "FooHeader" }

type barBadgeNode struct {
	barCatalogBase
	Tag string `json:"tag"`
}

func (barBadgeNode) ComponentType() string { return "BarBadge" }

type barButtonNode struct {
	barCatalogBase
	Label  v1.DynamicString `json:"label"`
	Action v1.Action        `json:"action"`
}

func (barButtonNode) ComponentType() string { return "BarButton" }

type brandBoxNode struct {
	v1.ComponentNode
	Child builder.Node `json:"child"`
}

func (brandBoxNode) ComponentType() string { return "BrandBox" }

type chartNode struct {
	v1.ComponentNode
	Series string `json:"series"`
}

func (chartNode) ComponentType() string { return "Chart" }

type chartCardNode struct {
	v1.ComponentNode
	Child builder.Node `json:"child"`
}

func (chartCardNode) ComponentType() string { return "ChartCard" }

type innerBadgeScopedNode struct {
	v1.ComponentNode
	Label string `json:"label"`
}

func (innerBadgeScopedNode) ComponentType() string { return "InnerBadgeScoped" }

type innerBadgeInheritedNode struct {
	v1.ComponentNode
	Label string `json:"label"`
}

func (innerBadgeInheritedNode) ComponentType() string { return "InnerBadgeInherited" }

type deferredCycleV09Node struct {
	v09.ComponentNode
	Title string `json:"title"`
}

func (deferredCycleV09Node) ComponentType() string { return "RecursiveCard" }

type deferredCycleV10Node struct {
	v1.ComponentNode
	Title string `json:"title,omitempty"`
	Label string `json:"label,omitempty"`
	Name  string
}

func (n deferredCycleV10Node) ComponentType() string {
	if n.Name != "" {
		return n.Name
	}
	return "DeferredCycle"
}

func (n deferredCycleV10Node) SerializeComponent(_ *builder.FlattenContext) (map[string]any, error) {
	out := make(map[string]any)
	if n.CatalogID != "" {
		out["@catalogId"] = n.CatalogID
	}
	if n.Title != "" {
		out["title"] = n.Title
	}
	if n.Label != "" {
		out["label"] = n.Label
	}
	return out, nil
}

type fakeSurfaceNode struct {
	v1.ComponentNode
}

func (fakeSurfaceNode) ComponentType() string { return "Surface" }

// --- Suite Reference Macros ---

type statusBadgeArgs struct {
	Status string `json:"status"`
	Title  string `json:"title"`
}

func buildSuiteMacrosV09() []*macros.Macro {
	statusBadgeFn := func(a statusBadgeArgs) *v09.Card {
		return v09.NewCard(
			v09.NewRow(v09.Children(
				v09.NewText(v09.Str(strings.ToUpper(a.Status))).WithVariant(v09.TextVariantCaption),
				v09.NewText(v09.Str(a.Title)).WithVariant(v09.TextVariantH3),
			)),
		)
	}

	type slotContainerArgs struct {
		Title   string       `json:"title"`
		Content builder.Node `json:"content"`
	}
	type multiSlotArgs struct {
		Header string         `json:"header"`
		Items  []builder.Node `json:"items"`
	}
	type actionButtonArgs struct {
		Label  string     `json:"label"`
		Action v09.Action `json:"action"`
	}
	type boundMetricArgs struct {
		Label string            `json:"label"`
		Value v09.DynamicString `json:"value"`
	}
	type configCardArgs struct {
		Name   string `json:"name"`
		Port   int    `json:"port"`
		Active bool   `json:"active"`
	}
	type nestedMacroArgs struct {
		Title  string `json:"title"`
		Status string `json:"status"`
	}
	type recursiveArgs struct {
		Title string `json:"title"`
	}
	type complexCardArgs struct {
		Title         string                      `json:"title"`
		DynamicTitle  v09.DynamicString           `json:"dynamic_title"`
		Metric        v09.DynamicNumber           `json:"metric"`
		IsActive      v09.DynamicBoolean          `json:"is_active"`
		Tags          v09.DynamicStringList       `json:"tags"`
		Anything      v09.DynamicValue            `json:"anything"`
		OnClick       v09.Action                  `json:"on_click"`
		Checks        []v09.CheckRule             `json:"checks"`
		Accessibility v09.AccessibilityAttributes `json:"accessibility"`
		Footer        *builder.ComponentRef       `json:"footer"`
		Items         []builder.Node              `json:"items"`
		Theme         string                      `json:"theme" enum:"primary,secondary"`
	}

	return []*macros.Macro{
		macros.MustNewPureMacro("StatusBadge", "Status badge with uppercase status and title.", statusBadgeFn),
		macros.MustNewPureMacro("SlotContainer", "Container accepting an external child slot.", func(a slotContainerArgs) *v09.Card {
			return v09.NewCard(v09.NewColumn(v09.Children(
				v09.NewText(v09.Str(a.Title)).WithVariant(v09.TextVariantH2),
				a.Content,
			)))
		}),
		macros.MustNewPureMacro("MultiSlotContainer", "Container accepting a list of child slots.", func(a multiSlotArgs) *v09.Card {
			ch := make([]builder.Node, 0, len(a.Items)+1)
			ch = append(ch, v09.NewText(v09.Str(a.Header)).WithVariant(v09.TextVariantH2))
			ch = append(ch, a.Items...)
			return v09.NewCard(v09.NewColumn(v09.Children(ch...)))
		}),
		macros.MustNewPureMacro("ActionButton", "Button with coerced action.", func(a actionButtonArgs) *v09.Button {
			return v09.NewButton(v09.NewText(v09.Str(a.Label)), a.Action).WithVariant(v09.ButtonVariantPrimary)
		}),
		macros.MustNewPureMacro("BoundMetric", "Metric card displaying a dynamic value.", func(a boundMetricArgs) *v09.Card {
			return v09.NewCard(v09.NewColumn(v09.Children(
				v09.NewText(v09.Str(a.Label)).WithVariant(v09.TextVariantCaption),
				v09.NewText(a.Value).WithVariant(v09.TextVariantH1),
			)))
		}),
		macros.MustNewPureMacro("ConfigCard", "Configuration card displaying primitives and metadata.", func(a configCardArgs) *v09.Card {
			return v09.NewCard(v09.NewColumn(v09.Children(
				v09.NewText(v09.Str(a.Name)).WithVariant(v09.TextVariantH2),
				v09.NewText(v09.Str(fmt.Sprintf("Port: %d", a.Port))).WithVariant(v09.TextVariantBody),
				v09.NewText(v09.Str(fmt.Sprintf("Active: %s", strconv.FormatBool(a.Active)))).WithVariant(v09.TextVariantBody),
			)))
		}),
		macros.MustNewPureMacro("NestedMacroCard", "Macro composing another macro.", func(a nestedMacroArgs) *v09.Card {
			return v09.NewCard(v09.NewColumn(v09.Children(
				v09.NewText(v09.Str(a.Title)).WithVariant(v09.TextVariantH1),
				statusBadgeFn(statusBadgeArgs{Status: a.Status, Title: a.Title + " Status"}),
			)))
		}),
		macros.MustNewPureMacro("RecursiveCard", "Macro composing itself recursively.", func(a recursiveArgs) *v09.Card {
			return v09.NewCard(&deferredCycleV09Node{Title: a.Title})
		}),
		macros.MustNewPureMacro("ComplexCard", "Card testing protocol common types in macro parameter schemas.", func(a complexCardArgs) *v09.Card {
			return v09.NewCard(v09.NewText(v09.Str(a.Title)))
		}),
	}
}

func buildSuiteMacrosV1_0() []*macros.Macro {
	statusBadgeFn := func(a statusBadgeArgs) *v1.Card {
		return v1.NewCard(
			v1.NewRow(v1.Children(
				v1.NewText(v1.Str(strings.ToUpper(a.Status))).WithVariant(v1.TextVariantCaption),
				v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
			)),
		)
	}

	type slotContainerArgs struct {
		Title   string       `json:"title"`
		Content builder.Node `json:"content"`
	}
	type multiSlotArgs struct {
		Header string         `json:"header"`
		Items  []builder.Node `json:"items"`
	}
	type actionButtonArgs struct {
		Label  string    `json:"label"`
		Action v1.Action `json:"action"`
	}
	type boundMetricArgs struct {
		Label string           `json:"label"`
		Value v1.DynamicString `json:"value"`
	}
	type configCardArgs struct {
		Name   string `json:"name"`
		Port   int    `json:"port"`
		Active bool   `json:"active"`
	}
	type nestedMacroArgs struct {
		Title  string `json:"title"`
		Status string `json:"status"`
	}
	type recursiveArgs struct {
		Title string `json:"title"`
	}
	type complexCardArgs struct {
		Title         string                     `json:"title"`
		DynamicTitle  v1.DynamicString           `json:"dynamic_title"`
		Metric        v1.DynamicNumber           `json:"metric"`
		IsActive      v1.DynamicBoolean          `json:"is_active"`
		Tags          v1.DynamicStringList       `json:"tags"`
		Anything      v1.DynamicValue            `json:"anything"`
		OnClick       v1.Action                  `json:"on_click"`
		Checks        []v1.CheckRule             `json:"checks"`
		Accessibility v1.AccessibilityAttributes `json:"accessibility"`
		Footer        *builder.ComponentRef      `json:"footer"`
		Items         []builder.Node             `json:"items"`
		Theme         string                     `json:"theme" enum:"primary,secondary"`
	}
	type payloadButtonArgs struct {
		Label     string          `json:"label"`
		EventName string          `json:"event_name"`
		Payload   v1.DynamicValue `json:"payload"`
		Extra     v1.DynamicValue `json:"extra"`
	}
	type dynamicFormArgs struct {
		Label       string           `json:"label"`
		Placeholder v1.DynamicString `json:"placeholder"`
		Items       v1.ChildList     `json:"items"`
		Checks      []v1.CheckRule   `json:"checks"`
		OnSubmit    v1.Action        `json:"on_submit"`
	}
	type declaredA11yArgs struct {
		Title         string                      `json:"title"`
		Accessibility *v1.AccessibilityAttributes `json:"accessibility,omitempty"`
	}
	type weightedCardArgs struct {
		Label  string   `json:"label"`
		Weight *float64 `json:"weight,omitempty"`
	}
	type positiveCountArgs struct {
		Count int `json:"count"`
	}

	return []*macros.Macro{
		macros.MustNewPureMacro("StatusBadge", "Status badge with uppercase status and title.", statusBadgeFn),
		macros.MustNewPureMacro("SlotContainer", "Container accepting an external child slot.", func(a slotContainerArgs) *v1.Card {
			return v1.NewCard(v1.NewColumn(v1.Children(
				v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
				a.Content,
			)))
		}),
		macros.MustNewPureMacro("MultiSlotContainer", "Container accepting a list of child slots.", func(a multiSlotArgs) *v1.Card {
			ch := make([]builder.Node, 0, len(a.Items)+1)
			ch = append(ch, v1.NewText(v1.Str(a.Header)).WithVariant(v1.TextVariantBody))
			ch = append(ch, a.Items...)
			return v1.NewCard(v1.NewColumn(v1.Children(ch...)))
		}),
		macros.MustNewPureMacro("ActionButton", "Button with coerced action.", func(a actionButtonArgs) *v1.Button {
			return v1.NewButton(v1.NewText(v1.Str(a.Label)), a.Action).WithVariant(v1.ButtonVariantPrimary)
		}),
		macros.MustNewPureMacro("BoundMetric", "Metric card displaying a dynamic value.", func(a boundMetricArgs) *v1.Card {
			return v1.NewCard(v1.NewColumn(v1.Children(
				v1.NewText(v1.Str(a.Label)).WithVariant(v1.TextVariantCaption),
				v1.NewText(a.Value).WithVariant(v1.TextVariantBody),
			)))
		}),
		macros.MustNewPureMacro("ConfigCard", "Configuration card displaying primitives and metadata.", func(a configCardArgs) *v1.Card {
			return v1.NewCard(v1.NewColumn(v1.Children(
				v1.NewText(v1.Str(a.Name)).WithVariant(v1.TextVariantBody),
				v1.NewText(v1.Str(fmt.Sprintf("Port: %d", a.Port))).WithVariant(v1.TextVariantBody),
				v1.NewText(v1.Str(fmt.Sprintf("Active: %s", strconv.FormatBool(a.Active)))).WithVariant(v1.TextVariantBody),
			)))
		}),
		macros.MustNewPureMacro("NestedMacroCard", "Macro composing another macro.", func(a nestedMacroArgs) *v1.Card {
			return v1.NewCard(v1.NewColumn(v1.Children(
				v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
				statusBadgeFn(statusBadgeArgs{Status: a.Status, Title: a.Title + " Status"}),
			)))
		}),
		macros.MustNewPureMacro("RecursiveCard", "Macro composing itself recursively.", func(a recursiveArgs) *v1.Card {
			return v1.NewCard(&deferredCycleV10Node{Name: "RecursiveCard", Title: a.Title})
		}),
		macros.MustNewPureMacro("ComplexCard", "Card testing protocol common types in macro parameter schemas.", func(a complexCardArgs) *v1.Card {
			return v1.NewCard(v1.NewText(v1.Str(a.Title)))
		}),
		macros.MustNewPureMacro("PayloadButton", "Button sending dynamic payload values inside an Action event context.", func(a payloadButtonArgs) *v1.Button {
			return v1.NewButton(
				v1.NewText(v1.Str(a.Label)),
				v1.Action{Event: &v1.ActionEvent{
					Name: a.EventName,
					Context: map[string]v1.DynamicValue{
						"payload": a.Payload,
						"extra":   a.Extra,
					},
				}},
			).WithVariant(v1.ButtonVariantPrimary)
		}),
		macros.MustNewPureMacro("DynamicFormCard", "Form card with dynamic child list, check rules, and submit action.", func(a dynamicFormArgs) *v1.Card {
			return v1.NewCard(v1.NewColumn(v1.Children(
				v1.NewTextField(v1.Str(a.Label), v1.Bind("/form/email")).
					WithPlaceholder(a.Placeholder).
					WithChecks(a.Checks...),
				v1.NewList(a.Items),
				v1.NewButton(v1.NewText(v1.Str("Submit")), a.OnSubmit).WithVariant(v1.ButtonVariantPrimary),
			)))
		}),
		macros.MustNewPureMacro("AnnotatedBadge", "Status badge whose root Card defines default accessibility and metadata extensions.", func(a statusBadgeArgs) *v1.Card {
			return v1.NewCard(
				v1.NewRow(v1.Children(
					v1.NewText(v1.Str(strings.ToUpper(a.Status))).WithVariant(v1.TextVariantCaption),
					v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
				)),
			).WithAccessibility(v1.AccessibilityAttributes{
				Description: v1.Str("Default badge description"),
			}).WithExtensions(v1.Extensions{
				"macroMeta": map[string]any{"source": "AnnotatedBadge"},
			})
		}),
		macros.MustNewPureMacro("DeclaredA11yCard", "Card declaring accessibility as an explicit macro parameter.", func(a declaredA11yArgs) *v1.Card {
			a11yLabel := "Internal"
			if a.Accessibility != nil {
				if sl, ok := a.Accessibility.Label.(v1.StringLiteral); ok {
					a11yLabel = "Custom: " + string(sl)
				}
			}
			return v1.NewCard(v1.NewText(v1.Str(a.Title))).WithAccessibility(v1.AccessibilityAttributes{
				Label: v1.Str(a11yLabel),
			})
		}),
		macros.MustNewPureMacro("WeightedCard", "Card declaring weight as an explicit macro parameter.", func(a weightedCardArgs) *v1.Card {
			card := v1.NewCard(v1.NewText(v1.Str(a.Label)))
			if a.Weight != nil {
				card = card.WithWeight(*a.Weight)
			}
			return card
		}),
		macros.MustNewMacro("PositiveCountCard", "Card raising ValidationError when count is negative.", func(a positiveCountArgs) (*v1.Card, error) {
			if a.Count < 0 {
				return nil, core.NewValidationError("count must be non-negative")
			}
			return v1.NewCard(v1.NewText(v1.Str(fmt.Sprintf("Count: %d", a.Count)))), nil
		}),
	}
}

func buildScopedSuiteMacros() map[string][]*macros.Macro {
	type brandTextArgs struct {
		Text    string         `json:"text"`
		Variant v1.TextVariant `json:"variant" default:"body"`
	}
	type titleArgs struct {
		Title string `json:"title"`
	}
	type labelArgs struct {
		Label string `json:"label"`
	}
	type seriesArgs struct {
		Series string `json:"series"`
	}
	type nameArgs struct {
		Name string `json:"name"`
	}
	type bazArgs struct {
		Headline v1.DynamicString `json:"headline"`
		BadgeTag string           `json:"badge_tag"`
		CTALabel string           `json:"cta_label"`
		OnCTA    v1.Action        `json:"on_cta"`
	}
	type emptyArgs struct{}

	return map[string][]*macros.Macro{
		brandCID: {
			macros.MustNewPureMacro("Text", "Custom brand Text macro wrapping a basic Text inside a Card.", func(a brandTextArgs) *v1.Card {
				return v1.NewCard(v1.NewText(v1.Str("[Brand] " + a.Text)).WithVariant(a.Variant))
			}),
			macros.MustNewPureMacro("UnannotatedBrandCard", "Brand card emitting unannotated Card, BrandBox, and Text nodes.", func(a titleArgs) *v1.Card {
				return v1.NewCard(&brandBoxNode{Child: v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody)})
			}),
			macros.MustNewPureMacro("BrandBadge", "Brand badge emitting basic Card and Text with explicit catalogId.", func(a labelArgs) *v1.Card {
				return v1.NewCard(
					v1.NewText(v1.Str("[Badge] " + a.Label)).WithVariant(v1.TextVariantBody).WithCatalogID(v10BasicCID),
				).WithCatalogID(v10BasicCID)
			}),
			macros.MustNewPureMacro("InnerBadgeScoped", "Scoped inner badge emitting BrandBox and unannotated basic Text.", func(a labelArgs) *brandBoxNode {
				n := &brandBoxNode{Child: v1.NewText(v1.Str("Scoped Badge: " + a.Label)).WithVariant(v1.TextVariantCaption)}
				n.CatalogID = brandCID
				return n
			}),
			macros.MustNewPureMacro("OuterPanelScoped", "Scoped outer panel emitting unannotated Text alongside deferred InnerBadgeScoped.", func(a titleArgs) *v1.Card {
				inner := &innerBadgeScopedNode{Label: a.Title}
				inner.CatalogID = brandCID
				return v1.NewCard(v1.NewColumn(v1.Children(
					v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
					inner,
				)))
			}),
			macros.MustNewPureMacro("Chart", "Brand Chart macro emitting ChartCard wrapping an unannotated Chart primitive.", func(a seriesArgs) *chartCardNode {
				return &chartCardNode{Child: &chartNode{Series: "[Brand] " + a.Series}}
			}),
		},
		brandSurfaceCID: {
			macros.MustNewPureMacro("Text", "Brand surface Text macro emitting cross-catalog basic Card and Text around BrandBox.", func(a brandTextArgs) *v1.Card {
				bb := &brandBoxNode{
					Child: v1.NewText(v1.Str("[Brand] " + a.Text)).WithVariant(a.Variant).WithCatalogID(v10BasicCID),
				}
				bb.CatalogID = brandSurfaceCID
				return v1.NewCard(bb).WithCatalogID(v10BasicCID)
			}),
			macros.MustNewPureMacro("BrandBadge", "Brand surface badge emitting cross-catalog basic Card and Text around BrandBox.", func(a labelArgs) *v1.Card {
				bb := &brandBoxNode{
					Child: v1.NewText(v1.Str("[Badge] " + a.Label)).WithVariant(v1.TextVariantBody).WithCatalogID(v10BasicCID),
				}
				bb.CatalogID = brandSurfaceCID
				return v1.NewCard(bb).WithCatalogID(v10BasicCID)
			}),
		},
		bazMacrosCID: {
			macros.MustNewPureMacro("BazMacro", "Composite macro combining FooCatalog and BarCatalog primitives with explicit catalogIds.", func(a bazArgs) *fooPanelNode {
				return &fooPanelNode{
					Children: v1.Children(
						&fooHeaderNode{Title: a.Headline},
						&barBadgeNode{Tag: a.BadgeTag},
						&barButtonNode{Label: v1.Str(a.CTALabel), Action: a.OnCTA},
					),
				}
			}),
		},
		catBCID: {
			macros.MustNewPureMacro("ProductCard", "Macro sharing its name with ProductCard primitive in catalog_a.json.", func(a nameArgs) *v1.Card {
				return v1.NewCard(v1.NewText(v1.Str("Product: " + a.Name)))
			}),
			macros.MustNewPureMacro("BrandBox", "Macro wrapping a same-named BrandBox primitive from catalog_a.json.", func(a titleArgs) *v1.Card {
				bb := &brandBoxNode{Child: v1.NewText(v1.Str(a.Title))}
				bb.CatalogID = catACID
				return v1.NewCard(bb)
			}),
			macros.MustNewPureMacro("InnerBadgeInherited", "Deferred inner macro inheriting enclosing catalogId when surface catalog is registered.", func(a labelArgs) *brandBoxNode {
				bb := &brandBoxNode{Child: v1.NewText(v1.Str("Inherited Badge: " + a.Label)).WithVariant(v1.TextVariantCaption)}
				bb.CatalogID = catACID
				return bb
			}),
			macros.MustNewPureMacro("OuterPanelInherited", "Outer macro emitting unannotated deferred InnerBadgeInherited node.", func(a titleArgs) *v1.Card {
				return v1.NewCard(v1.NewColumn(v1.Children(
					v1.NewText(v1.Str(a.Title)).WithVariant(v1.TextVariantBody),
					&innerBadgeInheritedNode{Label: a.Title},
				)))
			}),
			macros.MustNewPureMacro("DeferredCycle", "Deferred self-recursive macro node.", func(a labelArgs) *v1.Card {
				return v1.NewCard(&deferredCycleV10Node{Name: "DeferredCycle", Label: a.Label})
			}),
			macros.MustNewPureMacro("CycleA", "Mutually recursive deferred macro A referencing CycleB.", func(a labelArgs) *v1.Card {
				return v1.NewCard(&deferredCycleV10Node{Name: "CycleB", Label: a.Label})
			}),
			macros.MustNewPureMacro("CycleB", "Mutually recursive deferred macro B referencing CycleA.", func(a labelArgs) *v1.Card {
				return v1.NewCard(&deferredCycleV10Node{Name: "CycleA", Label: a.Label})
			}),
			macros.MustNewPureMacro("EmitsSurface", "Macro illegally emitting reserved Surface component in v1.0.", func(_ emptyArgs) *fakeSurfaceNode {
				return &fakeSurfaceNode{}
			}),
		},
	}
}
