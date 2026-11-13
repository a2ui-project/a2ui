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

package schemahelper

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

func TestSchemaHelperOrderingAndCheckable(t *testing.T) {
	rawCatalog := []byte(`{
  "protocolVersion": "1.0",
  "catalogId": "test/cat",
  "$defs": {
    "CatalogComponentCommon": {
      "allOf": [
        { "$ref": "common_types.json#/$defs/ComponentCommon" },
        { "properties": { "weight": { "type": "number" } } }
      ]
    }
  },
  "components": {
    "Button": {
      "allOf": [
        { "$ref": "#/$defs/CatalogComponentCommon" },
        {
          "type": "object",
          "properties": {
            "component": { "const": "Button" },
            "child": { "$ref": "common_types.json#/$defs/Child" },
            "variant": { "type": "string", "enum": ["primary", "secondary"] },
            "action": { "$ref": "common_types.json#/$defs/Action" }
          },
          "required": ["component", "child", "action"]
        }
      ]
    },
    "TextField": {
      "allOf": [
        { "$ref": "#/$defs/CatalogComponentCommon" },
        { "$ref": "common_types.json#/$defs/Checkable" },
        {
          "type": "object",
          "properties": {
            "component": { "const": "TextField" },
            "label": { "$ref": "common_types.json#/$defs/DynamicString" },
            "value": { "$ref": "common_types.json#/$defs/DataBinding" },
            "placeholder": { "$ref": "common_types.json#/$defs/DynamicString" }
          },
          "required": ["component", "label"]
        }
      ]
    },
    "Picker": {
      "type": "object",
      "properties": {
        "component": { "const": "Picker" },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": { "type": "string" },
              "value": { "type": "string" }
            }
          }
        }
      }
    }
  },
  "functions": {
    "regex": {
      "type": "object",
      "properties": {
        "@call": { "const": "regex" },
        "args": {
          "type": "object",
          "properties": {
            "value": {},
            "pattern": { "type": "string" }
          },
          "required": ["value", "pattern"]
        }
      }
    }
  }
}`)

	rawCommon := []byte(`{
  "$defs": {
    "DynamicNumber": {
      "oneOf": [
        { "type": "number" },
        { "type": "object", "properties": { "@path": { "type": "string" } } }
      ]
    },
    "IndexCall": {
      "type": "object",
      "description": "Zero-based template index.",
      "properties": {
        "@call": { "const": "@index" },
        "args": {
          "type": "object",
          "properties": {
            "offset": { "type": "integer" }
          }
        }
      }
    }
  }
}`)

	catAny, catKO, err := UnmarshalJSONPreservingOrder(rawCatalog)
	if err != nil {
		t.Fatalf("UnmarshalJSONPreservingOrder(catalog) failed: %v", err)
	}
	commonAny, commonKO, err := UnmarshalJSONPreservingOrder(rawCommon)
	if err != nil {
		t.Fatalf("UnmarshalJSONPreservingOrder(common) failed: %v", err)
	}

	h := NewCatalogSchemaHelperFromRaw(
		nil,
		catAny.(map[string]any),
		catKO,
		commonAny.(map[string]any),
		commonKO,
		true,
	)

	// Specific properties MUST come before mixin 'weight', preserving JSON definition order!
	wantButton := []string{"child", "variant", "action", "weight"}
	if got := h.ComponentProperties("Button"); !reflect.DeepEqual(got, wantButton) {
		t.Errorf("Button properties = %v, want %v", got, wantButton)
	}
	if !IsActionSlot(h.PropertySchema("Button", "action")) {
		t.Errorf("Button.action should be detected as Action slot")
	}
	if got := h.PropertyType("Button", "child"); got != "Child" {
		t.Errorf("Button.child PropertyType = %q, want Child", got)
	}
	if got := h.PropertyEnumStrings("Button", "variant"); !reflect.DeepEqual(got, []string{"primary", "secondary"}) {
		t.Errorf("Button.variant enum = %v, want [primary secondary]", got)
	}
	if !h.AcceptsNumber(h.PropertySchema("Button", "weight")) {
		t.Errorf("Button.weight should accept number")
	}

	// Checkable component MUST move 'checks' after 'weight' at the very end!
	wantTF := []string{"label", "value", "placeholder", "weight", "checks"}
	if got := h.ComponentProperties("TextField"); !reflect.DeepEqual(got, wantTF) {
		t.Errorf("TextField properties = %v, want %v", got, wantTF)
	}
	if !h.IsCheckable("TextField") {
		t.Errorf("TextField should be checkable")
	}

	// Option objects detection
	if !ExpectsOptionObjects(h.PropertySchema("Picker", "options")) {
		t.Errorf("Picker.options should expect option objects")
	}

	// Function property order ('value' before 'pattern', NOT alphabetical 'pattern' before 'value'!)
	wantRegex := []string{"value", "pattern"}
	if got := h.FunctionProperties("regex"); !reflect.DeepEqual(got, wantRegex) {
		t.Errorf("regex properties = %v, want %v", got, wantRegex)
	}

	// System function @index extraction
	wantIndex := []string{"offset"}
	if got := h.FunctionProperties("@index"); !reflect.DeepEqual(got, wantIndex) {
		t.Errorf("@index properties = %v, want %v", got, wantIndex)
	}
}

func TestCoalesceSurfaceMessages(t *testing.T) {
	payload := []core.AgentToRendererMessage{
		{
			"version": "v0.9",
			"createSurface": map[string]any{
				"surfaceId": "s1",
				"catalogId": "basic",
			},
		},
		{
			"version": "v0.9",
			"updateComponents": map[string]any{
				"surfaceId": "s1",
				"components": []any{
					map[string]any{"id": "root", "component": "Text", "text": "Hi"},
				},
			},
		},
		{
			"version": "v0.9",
			"updateDataModel": map[string]any{
				"surfaceId": "s1",
				"path":      "/",
				"value":     map[string]any{"user": "Ada"},
			},
		},
		{
			"version": "v0.9",
			"updateDataModel": map[string]any{
				"surfaceId": "s1",
				"path":      "/count",
				"value":     int64(1),
			},
		},
	}

	got := CoalesceSurfaceMessages(payload)
	if len(got) != 2 {
		t.Fatalf("CoalesceSurfaceMessages len = %d, want 2", len(got))
	}
	if got[0].Operation() != "createSurface" || got[0].IsUpdate() {
		t.Errorf("item 0 op = %q isUpdate = %v", got[0].Operation(), got[0].IsUpdate())
	}
	createBody := got[0].Message["createSurface"].(map[string]any)
	if _, ok := createBody["components"]; !ok {
		t.Errorf("expected components merged into createSurface")
	}
	if _, ok := createBody["dataModel"]; !ok {
		t.Errorf("expected root dataModel merged into createSurface")
	}
	if got[1].Operation() != "updateDataModel" || !got[1].IsUpdate() || got[1].SurfaceCatalogID != "basic" {
		t.Errorf("item 1 = %+v, want incremental update with SurfaceCatalogID='basic'", got[1])
	}
}

func TestBasicCatalogRealFileCrawling(t *testing.T) {
	catPath := filepath.Join("..", "..", "..", "..", "catalogs", "basic", "v1", "catalog.json")
	rawCat, err := os.ReadFile(catPath)
	if err != nil {
		t.Skipf("catalog file not found at %s: %v", catPath, err)
	}
	commonPath := filepath.Join("..", "..", "..", "..", "specification", "v1_0", "json", "common_types.json")
	rawCommon, err := os.ReadFile(commonPath)
	if err != nil {
		t.Skipf("common_types not found at %s: %v", commonPath, err)
	}

	catAny, catKO, err := UnmarshalJSONPreservingOrder(rawCat)
	if err != nil {
		t.Fatal(err)
	}
	commonAny, commonKO, err := UnmarshalJSONPreservingOrder(rawCommon)
	if err != nil {
		t.Fatal(err)
	}

	h := NewCatalogSchemaHelperFromRaw(
		nil,
		catAny.(map[string]any),
		catKO,
		commonAny.(map[string]any),
		commonKO,
		true,
	)

	textProps := h.ComponentProperties("Text")
	if len(textProps) < 2 || textProps[0] != "text" || textProps[len(textProps)-1] != "weight" {
		t.Errorf("BasicCatalog Text properties = %v, want first='text' and last='weight'", textProps)
	}
}

func newEnvelopeHelper(t *testing.T) *CatalogSchemaHelper {
	t.Helper()
	rawCatalog := []byte(`{
  "catalogId": "envelope",
  "protocolVersion": "1.0",
  "components": {
    "AtInline": {
      "type": "object",
      "properties": {
        "component": { "const": "AtInline" },
        "label": { "type": "string" },
        "@catalogId": { "type": "string" },
        "@accessibility": { "$ref": "common_types.json#/$defs/AccessibilityAttributes" },
        "@metadata": { "type": "object" },
        "@checks": { "type": "array", "items": { "$ref": "common_types.json#/$defs/CheckRule" } }
      },
      "required": ["component"]
    },
    "BareChecks": {
      "type": "object",
      "properties": {
        "component": { "const": "BareChecks" },
        "checks": { "type": "array", "items": { "$ref": "common_types.json#/$defs/CheckRule" } },
        "label": { "type": "string" }
      },
      "required": ["component"]
    },
    "Custom": {
      "type": "object",
      "properties": {
        "component": { "const": "Custom" },
        "metadata": { "type": "string" },
        "accessibility": { "type": "boolean" },
        "checks": { "type": "integer" },
        "catalogId": { "type": "string" }
      },
      "required": ["component"]
    }
  }
}`)
	catAny, catKO, err := UnmarshalJSONPreservingOrder(rawCatalog)
	if err != nil {
		t.Fatalf("UnmarshalJSONPreservingOrder(catalog) failed: %v", err)
	}
	return NewCatalogSchemaHelperFromRaw(nil, catAny.(map[string]any), catKO, nil, nil, false)
}

func TestSchemaHelperAtPrefixedEnvelopePropertiesAreNotDSLParameters(t *testing.T) {
	h := newEnvelopeHelper(t)
	if got, want := h.ComponentProperties("AtInline"), []string{"label", "checks"}; !reflect.DeepEqual(got, want) {
		t.Errorf("AtInline properties = %v, want %v", got, want)
	}
	if !h.IsCheckable("AtInline") {
		t.Error("AtInline should be checkable through @checks")
	}
	if got := h.CustomEnvelopeProperties("AtInline"); len(got) != 0 {
		t.Errorf("AtInline custom envelope properties = %v, want none", got)
	}
}

func TestSchemaHelperBareStandardChecksPropertyMakesComponentCheckable(t *testing.T) {
	h := newEnvelopeHelper(t)
	if got, want := h.ComponentProperties("BareChecks"), []string{"label", "checks"}; !reflect.DeepEqual(got, want) {
		t.Errorf("BareChecks properties = %v, want %v", got, want)
	}
	if !h.IsCheckable("BareChecks") {
		t.Error("BareChecks should be checkable through its list of check rules")
	}
	if got := h.CustomEnvelopeProperties("BareChecks"); len(got) != 0 {
		t.Errorf("BareChecks custom envelope properties = %v, want none", got)
	}
}

func TestSchemaHelperCustomPropertiesNamedAfterEnvelopeMixinsAreOrdinary(t *testing.T) {
	h := newEnvelopeHelper(t)
	want := []string{"metadata", "accessibility", "checks", "catalogId"}
	if got := h.ComponentProperties("Custom"); !reflect.DeepEqual(got, want) {
		t.Errorf("Custom properties = %v, want %v", got, want)
	}
	if h.IsCheckable("Custom") {
		t.Error("Custom should not be checkable")
	}
	wantCustom := map[string]bool{"metadata": true, "accessibility": true, "checks": true, "catalogId": true}
	if got := h.CustomEnvelopeProperties("Custom"); !reflect.DeepEqual(got, wantCustom) {
		t.Errorf("Custom custom envelope properties = %v, want %v", got, wantCustom)
	}
}
