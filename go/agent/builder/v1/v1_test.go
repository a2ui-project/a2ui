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

package v1_test

import (
	"reflect"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
)

func TestV1LiteralObjectValidationAndEnvelopes(t *testing.T) {
	// Valid literal object without @-prefixed keys succeeds.
	validBtn := v1.NewButton(
		v1.NewText(v1.Str("Run")),
		v1.Action{Event: &v1.ActionEvent{
			Name:        "exec",
			UserMessage: v1.FormatString(v1.Str("Running ${/cmd}")),
			Context: map[string]v1.DynamicValue{
				"payload": v1.Obj(map[string]any{"path": "/usr/bin", "call": "noop"}),
			},
		}},
	).WithID("root")

	msg, err := v1.UpdateComponentsFromTree("s1", validBtn, "")
	if err != nil {
		t.Fatalf("UpdateComponentsFromTree failed: %v", err)
	}
	if msg["version"] != "1.0" {
		t.Fatalf("expected wire version '1.0', got %v", msg["version"])
	}

	// Reserved @path key in literal object is rejected.
	invalidBtn := v1.NewButton(
		v1.NewText(v1.Str("Bad")),
		v1.Action{Event: &v1.ActionEvent{
			Name: "exec",
			Context: map[string]v1.DynamicValue{
				"bad": v1.Obj(map[string]any{"@path": "/sneaky"}),
			},
		}},
	).WithID("root")
	if _, err := builder.FlattenComponentTree(invalidBtn, ""); err == nil {
		t.Fatal("expected Obj containing '@path' to fail validation")
	}

	// Verify DeleteSurface and UpdateDataModel(nil) preserve explicit null value.
	del := v1.DeleteSurface("s1")
	if !reflect.DeepEqual(del["deleteSurface"], map[string]any{"surfaceId": "s1"}) {
		t.Fatalf("unexpected deleteSurface: %#v", del)
	}
	udm := v1.UpdateDataModel("s1", "/obsolete", nil)
	udmBody := udm["updateDataModel"].(map[string]any)
	if _, hasValue := udmBody["value"]; !hasValue {
		t.Fatalf("expected v1.0 UpdateDataModel with nil value to retain explicit 'value': nil key, got %#v", udmBody)
	}
}

func TestV1EnvelopeFieldsSerializeUnderAtKeys(t *testing.T) {
	tf := v1.NewTextField(v1.Str("Name"), v1.Bind("/name")).
		WithCatalogID("https://example.com/custom.json").
		WithAccessibility(v1.AccessibilityAttributes{Label: v1.Str("Your name")}).
		WithExtensions(v1.Extensions{"trace": "t1"}).
		WithChecks(v1.NewCheckRule(v1.Required(v1.Bind("/name")), ""))

	flat, err := tf.Flatten("name")
	if err != nil {
		t.Fatalf("Flatten failed: %v", err)
	}
	want := map[string]any{
		"component":      "TextField",
		"id":             "name",
		"label":          "Name",
		"value":          map[string]any{"@path": "/name"},
		"variant":        "shortText",
		"@catalogId":     "https://example.com/custom.json",
		"@accessibility": map[string]any{"label": "Your name"},
		"@metadata":      map[string]any{"extensions": map[string]any{"trace": "t1"}},
		"@checks": []any{map[string]any{
			"condition": map[string]any{"@call": "required", "args": map[string]any{"value": map[string]any{"@path": "/name"}}},
		}},
	}
	if len(flat) != 1 || !reflect.DeepEqual(flat[0], want) {
		t.Fatalf("unexpected TextField wire form:\n got: %#v\nwant: %#v", flat, want)
	}
}

// customEnvelopeProps declares its own properties under the bare envelope names.
type customEnvelopeProps struct {
	v1.ComponentNode
	CustomCatalogID     string `json:"catalogId"`
	CustomMetadata      string `json:"metadata"`
	CustomAccessibility string `json:"accessibility"`
	CustomChecks        string `json:"checks"`
}

func (customEnvelopeProps) ComponentType() string { return "CustomEnvelopeProps" }

func TestV1CustomPropertiesWithBareEnvelopeNamesKeepTheirKeys(t *testing.T) {
	node := &customEnvelopeProps{
		CustomCatalogID:     "custom-cat",
		CustomMetadata:      "custom-meta",
		CustomAccessibility: "custom-a11y",
		CustomChecks:        "custom-checks",
	}
	node.CatalogID = "https://example.com/catalogs/custom/v1/catalog.json"
	node.Accessibility = &v1.AccessibilityAttributes{Label: v1.Str("A11y label")}
	node.Extensions = v1.Extensions{"trace": map[string]any{"step": "one"}}

	flat, err := builder.FlattenComponentTree(node, "cep1")
	if err != nil {
		t.Fatalf("FlattenComponentTree failed: %v", err)
	}
	want := []map[string]any{{
		"component":      "CustomEnvelopeProps",
		"id":             "cep1",
		"@catalogId":     "https://example.com/catalogs/custom/v1/catalog.json",
		"@accessibility": map[string]any{"label": "A11y label"},
		"@metadata":      map[string]any{"extensions": map[string]any{"trace": map[string]any{"step": "one"}}},
		"catalogId":      "custom-cat",
		"metadata":       "custom-meta",
		"accessibility":  "custom-a11y",
		"checks":         "custom-checks",
	}}
	if !reflect.DeepEqual(flat, want) {
		t.Fatalf("unexpected custom node wire form:\n got: %#v\nwant: %#v", flat, want)
	}
}
