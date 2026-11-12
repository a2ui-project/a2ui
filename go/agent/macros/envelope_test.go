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
	"reflect"
	"testing"

	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/macros"
	"github.com/a2ui-project/a2ui/go/core"
)

var bareEnvelopeKeys = []string{"catalogId", "metadata", "accessibility", "checks"}

func checkRuleJSON(path, message string) map[string]any {
	return map[string]any{"condition": map[string]any{"@path": path}, "message": message}
}

// lowerByID lowers msgs through a fresh session that tracks trackedSurfaces (surface ID to
// default catalogId) and returns the components of the last message keyed by ID.
func lowerByID(
	t *testing.T,
	exp *macros.MacroExpander,
	trackedSurfaces map[string]string,
	msgs ...core.AgentToRendererMessage,
) map[string]map[string]any {
	t.Helper()
	session := exp.NewSession()
	for sid, cid := range trackedSurfaces {
		session.TrackSurface(sid, cid)
	}
	lowered, err := session.TransformToTransport(msgs)
	if err != nil {
		t.Fatalf("TransformToTransport failed: %v", err)
	}
	body, _ := lowered[len(lowered)-1]["updateComponents"].(map[string]any)
	comps, _ := body["components"].([]any)
	byID := make(map[string]map[string]any, len(comps))
	for _, c := range comps {
		comp, _ := c.(map[string]any)
		id, _ := comp["id"].(string)
		byID[id] = comp
	}
	return byID
}

func assertNoBareEnvelopeKeys(t *testing.T, comp map[string]any) {
	t.Helper()
	for _, key := range bareEnvelopeKeys {
		if _, ok := comp[key]; ok {
			t.Fatalf("component %v carries bare %q, want only @-prefixed envelope keys: %#v", comp["id"], key, comp)
		}
	}
}

func assertJSONEqual(t *testing.T, field string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s = %#v, want %#v", field, got, want)
	}
}

func TestV1EnvelopeFieldsMergeOntoExpandedRootAsAtKeys(t *testing.T) {
	type badgeArgs struct {
		Status string `json:"status"`
	}
	badge := macros.MustNewPureMacro("StatusBadge", "", func(a badgeArgs) *v1.Card {
		return v1.NewCard(v1.NewText(v1.Str(a.Status))).
			WithAccessibility(v1.AccessibilityAttributes{Description: v1.Str("Default")}).
			WithExtensions(v1.Extensions{"macroMeta": map[string]any{"source": "StatusBadge"}})
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{badge}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	rule := checkRuleJSON("/form/valid", "Invalid")

	// The @ keys and the legacy bare keys both lower to @ keys on the root.
	for name, prefix := range map[string]string{"at-prefixed": "@", "legacy-bare": ""} {
		t.Run(name, func(t *testing.T) {
			root := lowerByID(t, exp, nil, v1.UpdateComponents("main", []map[string]any{{
				"component":              "StatusBadge",
				"id":                     "b1",
				"status":                 "ok",
				prefix + "accessibility": map[string]any{"label": "Server status badge"},
				prefix + "metadata":      map[string]any{"extensions": map[string]any{"telemetry": map[string]any{"traceId": "t1"}}},
				prefix + "checks":        []any{rule},
			}}))["b1"]
			if root["component"] != "Card" {
				t.Fatalf("root component = %v, want Card", root["component"])
			}
			assertJSONEqual(t, "@accessibility", root["@accessibility"], map[string]any{
				"description": "Default",
				"label":       "Server status badge",
			})
			assertJSONEqual(t, "@metadata", root["@metadata"], map[string]any{"extensions": map[string]any{
				"macroMeta": map[string]any{"source": "StatusBadge"},
				"telemetry": map[string]any{"traceId": "t1"},
			}})
			assertJSONEqual(t, "@checks", root["@checks"], []any{rule})
			assertNoBareEnvelopeKeys(t, root)
		})
	}

	// The @ key wins over a legacy bare key on the same instance.
	root := lowerByID(t, exp, nil, v1.UpdateComponents("main", []map[string]any{{
		"component":      "StatusBadge",
		"id":             "b2",
		"status":         "ok",
		"@accessibility": map[string]any{"label": "New"},
		"accessibility":  map[string]any{"label": "Legacy"},
	}}))["b2"]
	assertJSONEqual(t, "@accessibility", root["@accessibility"], map[string]any{"description": "Default", "label": "New"})
	assertNoBareEnvelopeKeys(t, root)
}

func TestV1DeclaredEnvelopeNamesAreMacroArguments(t *testing.T) {
	type fieldArgs struct {
		Label         string                      `json:"label"`
		Metadata      string                      `json:"metadata,omitempty"`
		Checks        []v1.CheckRule              `json:"checks,omitempty"`
		Accessibility *v1.AccessibilityAttributes `json:"accessibility,omitempty"`
	}
	field := macros.MustNewPureMacro("EmailField", "", func(a fieldArgs) *v1.TextField {
		tf := v1.NewTextField(v1.Str(a.Label+":"+a.Metadata), v1.Bind("/email")).WithChecks(a.Checks...)
		if a.Accessibility != nil {
			tf = tf.WithAccessibility(*a.Accessibility)
		}
		return tf
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{field}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	paramRule := checkRuleJSON("/email", "Required")
	envelopeRule := checkRuleJSON("/form/valid", "Invalid")

	// Bare names the macro declares are its arguments; the @ keys stay envelope fields that
	// merge onto, or append to, what the macro built from those arguments.
	root := lowerByID(t, exp, nil, v1.UpdateComponents("main", []map[string]any{{
		"component":      "EmailField",
		"id":             "f1",
		"label":          "Email",
		"metadata":       "m1",
		"checks":         []any{paramRule},
		"accessibility":  map[string]any{"label": "Param label"},
		"@checks":        []any{envelopeRule},
		"@accessibility": map[string]any{"description": "Envelope description"},
		"@metadata":      map[string]any{"extensions": map[string]any{"trace": map[string]any{"id": "x"}}},
	}}))["f1"]
	if root["label"] != "Email:m1" {
		t.Fatalf("label = %v, want the declared metadata argument folded in (Email:m1)", root["label"])
	}
	assertJSONEqual(t, "@checks", root["@checks"], []any{paramRule, envelopeRule})
	assertJSONEqual(t, "@accessibility", root["@accessibility"], map[string]any{
		"label":       "Param label",
		"description": "Envelope description",
	})
	assertJSONEqual(t, "@metadata", root["@metadata"], map[string]any{"extensions": map[string]any{"trace": map[string]any{"id": "x"}}})
	assertNoBareEnvelopeKeys(t, root)
}

func TestV1MacroCatalogIDDualReadAndPrimitiveStamping(t *testing.T) {
	basic := core.MustBasicCatalog(core.Version1_0)
	const brandCID = "https://example.com/brand.json"
	type labelArgs struct {
		Label string `json:"label"`
	}
	badge := macros.MustNewPureMacro("BrandBadge", "", func(a labelArgs) *v1.Card {
		return v1.NewCard(v1.NewText(v1.Str(a.Label)))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{badge}, &macros.ExpanderOptions{
		CatalogID:    brandCID,
		BaseCatalogs: []*core.Catalog{basic},
		OnError:      macros.OnErrorRaise,
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	defaultless := map[string]string{"main": ""}

	for _, key := range []string{"@catalogId", "catalogId"} {
		t.Run(key, func(t *testing.T) {
			byID := lowerByID(t, exp, defaultless, v1.UpdateComponents("main", []map[string]any{{
				"id":        "b1",
				"component": "BrandBadge",
				key:         brandCID,
				"label":     "Hi",
			}}))
			if len(byID) != 2 || byID["b1"]["component"] != "Card" || byID["b1__text_1"]["component"] != "Text" {
				t.Fatalf("expected BrandBadge to lower to Card and Text, got %#v", byID)
			}
			for id, comp := range byID {
				if comp["@catalogId"] != basic.CatalogID() {
					t.Fatalf("%s @catalogId = %v, want the stamped basic catalog", id, comp["@catalogId"])
				}
				assertNoBareEnvelopeKeys(t, comp)
			}
		})
	}

	// A legacy bare catalogId does not override the @catalogId that scopes the instance.
	byID := lowerByID(t, exp, defaultless, v1.UpdateComponents("main", []map[string]any{{
		"id":         "b2",
		"component":  "BrandBadge",
		"@catalogId": "https://example.com/other.json",
		"catalogId":  brandCID,
		"label":      "Hi",
	}}))
	if byID["b2"]["component"] != "BrandBadge" {
		t.Fatalf("expected the instance scoped to another catalog to stay unexpanded, got %#v", byID)
	}
}

func TestV1DeclaredCatalogIDParameterDoesNotRouteMacro(t *testing.T) {
	const brandCID = "https://example.com/brand.json"
	type taggedArgs struct {
		CatalogID string `json:"catalogId"`
	}
	tagged := macros.MustNewPureMacro("Tagged", "", func(a taggedArgs) *v1.Text {
		return v1.NewText(v1.Str("tag:" + a.CatalogID))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{tagged}, &macros.ExpanderOptions{
		CatalogID: brandCID,
		OnError:   macros.OnErrorRaise,
	})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}

	// @catalogId routes the instance to the scoped expander; the declared bare catalogId is
	// an ordinary argument.
	root := lowerByID(t, exp, nil, v1.UpdateComponents("main", []map[string]any{{
		"id":         "t1",
		"component":  "Tagged",
		"@catalogId": brandCID,
		"catalogId":  "param-value",
	}}))["t1"]
	if root["component"] != "Text" || root["text"] != "tag:param-value" {
		t.Fatalf("expected Tagged to expand with catalogId as its argument, got %#v", root)
	}

	// Without @catalogId, the declared bare catalogId does not select the macro catalog.
	root = lowerByID(t, exp, nil, v1.UpdateComponents("main", []map[string]any{{
		"id":        "t2",
		"component": "Tagged",
		"catalogId": brandCID,
	}}))["t2"]
	if root["component"] != "Tagged" {
		t.Fatalf("expected Tagged to stay unexpanded without @catalogId, got %#v", root)
	}
}

func TestV09EnvelopeFieldsStayBareOnExpandedRoot(t *testing.T) {
	type panelArgs struct {
		Title string `json:"title"`
	}
	panel := macros.MustNewPureMacro("Panel", "", func(a panelArgs) *v09.Card {
		return v09.NewCard(v09.NewText(v09.Str(a.Title)))
	})
	exp, err := macros.NewMacroExpander([]*macros.Macro{panel}, &macros.ExpanderOptions{OnError: macros.OnErrorRaise})
	if err != nil {
		t.Fatalf("NewMacroExpander failed: %v", err)
	}
	rule := map[string]any{"condition": true, "message": "Required"}

	root := lowerByID(t, exp, nil, v09.UpdateComponents("main", []map[string]any{{
		"component":     "Panel",
		"id":            "p1",
		"title":         "Hello",
		"accessibility": map[string]any{"label": "Panel"},
		"checks":        []any{rule},
		"metadata":      map[string]any{"extensions": map[string]any{"x": map[string]any{}}},
	}}))["p1"]
	if root["component"] != "Card" {
		t.Fatalf("root component = %v, want Card", root["component"])
	}
	assertJSONEqual(t, "accessibility", root["accessibility"], map[string]any{"label": "Panel"})
	assertJSONEqual(t, "checks", root["checks"], []any{rule})
	for key := range root {
		if key == "metadata" || key[0] == '@' {
			t.Fatalf("v0.9 root must carry only bare accessibility and checks envelope keys, got %q in %#v", key, root)
		}
	}
}

// catalogBadgeNode is a custom primitive whose catalog may declare catalogId as its own property.
type catalogBadgeNode struct {
	v1.ComponentNode
	CustomCatalogID string `json:"catalogId"`
}

func (catalogBadgeNode) ComponentType() string { return "CatalogBadge" }

func TestStampLoweredPrimitivesRespectsCustomCatalogIDProperty(t *testing.T) {
	const customCID = "https://example.com/custom_badge_cat.json"
	badgeSchema := func(props map[string]any) *core.Catalog {
		t.Helper()
		props["component"] = map[string]any{"const": "CatalogBadge"}
		cat, err := core.CatalogFromJSON(map[string]any{
			"$schema":         "https://json-schema.org/draft/2020-12/schema",
			"catalogId":       customCID,
			"protocolVersion": "1.0",
			"components": map[string]any{
				"CatalogBadge": map[string]any{
					"type": "object",
					"allOf": []any{
						map[string]any{"$ref": "common_types.json#/$defs/ComponentCommon"},
						map[string]any{"type": "object", "properties": props, "required": []any{"component"}},
					},
					"unevaluatedProperties": false,
				},
			},
		}, &core.CatalogLoadOptions{CatalogID: customCID, ProtocolVersion: core.Version1_0})
		if err != nil {
			t.Fatalf("CatalogFromJSON failed: %v", err)
		}
		return cat
	}
	type emptyArgs struct{}
	wrapper := macros.MustNewPureMacro("BadgeWrapper", "", func(emptyArgs) *catalogBadgeNode {
		return &catalogBadgeNode{CustomCatalogID: "custom-prop-val"}
	})
	lower := func(t *testing.T, base *core.Catalog) map[string]any {
		t.Helper()
		exp, err := macros.NewMacroExpander([]*macros.Macro{wrapper}, &macros.ExpanderOptions{
			BaseCatalogs: []*core.Catalog{base},
			OnError:      macros.OnErrorRaise,
		})
		if err != nil {
			t.Fatalf("NewMacroExpander failed: %v", err)
		}
		return lowerByID(t, exp, map[string]string{"main": ""}, v1.UpdateComponents("main", []map[string]any{{
			"id":         "b1",
			"component":  "BadgeWrapper",
			"@catalogId": macros.DefaultMacroCatalogID,
		}}))["b1"]
	}

	t.Run("custom property", func(t *testing.T) {
		// The catalog declares catalogId as an ordinary property, so the primitive still
		// needs its owning @catalogId stamped.
		got := lower(t, badgeSchema(map[string]any{"catalogId": map[string]any{"type": "string"}}))
		if got["@catalogId"] != customCID || got["catalogId"] != "custom-prop-val" {
			t.Fatalf("expected stamped @catalogId beside the custom catalogId property, got %#v", got)
		}
	})
	t.Run("custom property beside an inline id", func(t *testing.T) {
		// Only the standard ComponentCommon description marks a bare catalogId as the
		// mixin, so a string catalogId with its own description is a custom property even
		// when the schema also declares id inline.
		got := lower(t, badgeSchema(map[string]any{
			"id":        map[string]any{"type": "string"},
			"catalogId": map[string]any{"type": "string", "description": "The product catalog the badge advertises."},
		}))
		if got["@catalogId"] != customCID || got["catalogId"] != "custom-prop-val" {
			t.Fatalf("expected stamped @catalogId beside the custom catalogId property, got %#v", got)
		}
	})
	t.Run("legacy envelope key", func(t *testing.T) {
		// Without that declaration, a bare catalogId is the legacy form of @catalogId and
		// already names the primitive's catalog.
		got := lower(t, badgeSchema(map[string]any{"label": map[string]any{"type": "string"}}))
		if _, stamped := got["@catalogId"]; stamped || got["catalogId"] != "custom-prop-val" {
			t.Fatalf("expected the legacy bare catalogId to be kept without stamping, got %#v", got)
		}
	})
}
