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

package core_test

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

func TestParseJSONKeepsIntegersAndFloatsApart(t *testing.T) {
	got, err := core.ParseJSON([]byte(`{
		"int": 1500, "float": 1500.0, "exp": 1e3, "negZero": -0.0, "neg": -7,
		"big": 9223372036854775808, "tiny": 1e-400,
		"list": [1, 2.5, {"nested": 3}], "s": "x", "b": true, "n": null
	}`))
	if err != nil {
		t.Fatalf("ParseJSON: %v", err)
	}
	want := map[string]any{
		"int": int64(1500), "float": 1500.0, "exp": 1000.0, "negZero": math.Copysign(0, -1), "neg": int64(-7),
		"big": 9223372036854775808.0, "tiny": 0.0,
		"list": []any{int64(1), 2.5, map[string]any{"nested": int64(3)}}, "s": "x", "b": true, "n": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseJSON got %#v, want %#v", got, want)
	}
	if f := got.(map[string]any)["negZero"].(float64); !math.Signbit(f) {
		t.Fatalf("ParseJSON lost the sign of -0.0")
	}
}

func TestParseJSONRejectsInvalidInput(t *testing.T) {
	for name, input := range map[string]string{
		"empty":          "",
		"whitespace":     "  \n ",
		"trailing value": `{"a": 1} {"b": 2}`,
		"trailing junk":  `[1, 2] x`,
		"overflow":       `{"a": 1e400}`,
		"syntax":         `{"a": }`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := core.ParseJSON([]byte(input))
			var parseErr *core.ParseError
			if !errors.As(err, &parseErr) {
				t.Fatalf("ParseJSON(%q) = %v, want a *core.ParseError", input, err)
			}
		})
	}
	if got, err := core.ParseJSON([]byte(" 42 \n")); err != nil || got != int64(42) {
		t.Fatalf("ParseJSON with surrounding whitespace = (%#v, %v), want (42, nil)", got, err)
	}
}

func TestEnvelopeJSONRoundTripsAndCatalogMapIsolation(t *testing.T) {
	var resp core.FunctionResponsePayload
	if err := json.Unmarshal([]byte(`{"functionCallId":"c1","value":null}`), &resp); err != nil {
		t.Fatalf("Unmarshal FunctionResponsePayload: %v", err)
	}
	if !resp.HasValue || resp.Value != nil {
		t.Fatalf("expected HasValue=true and nil Value, got %+v", resp)
	}
	reencoded, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Marshal FunctionResponsePayload: %v", err)
	}
	if !strings.Contains(string(reencoded), `"value":null`) {
		t.Fatalf("expected explicit null value on re-marshal, got %s", reencoded)
	}

	origErr := core.RendererErrorPayload{
		Code:      "VALIDATION_FAILED",
		Message:   "bad prop",
		SurfaceID: "s1",
		Extra:     map[string]any{"retryable": false, "attempt": int64(2)},
	}
	errBytes, err := json.Marshal(origErr)
	if err != nil {
		t.Fatalf("Marshal RendererErrorPayload: %v", err)
	}
	var decodedErr core.RendererErrorPayload
	if err := json.Unmarshal(errBytes, &decodedErr); err != nil {
		t.Fatalf("Unmarshal RendererErrorPayload: %v", err)
	}
	if !reflect.DeepEqual(decodedErr, origErr) {
		t.Fatalf("RendererErrorPayload round-trip got %#v, want %#v", decodedErr, origErr)
	}

	capBytes, err := json.Marshal(core.RendererCapabilityEntry{})
	if err != nil {
		t.Fatalf("Marshal RendererCapabilityEntry: %v", err)
	}
	if string(capBytes) != `{"supportedCatalogIds":[]}` {
		t.Fatalf("RendererCapabilityEntry marshaled as %s, want {\"supportedCatalogIds\":[]}", capBytes)
	}

	cat := core.MustBasicCatalog(core.Version1_0)
	comps := cat.Components()
	delete(comps, "Text")
	if _, ok := cat.Components()["Text"]; !ok {
		t.Fatalf("mutating Components() map mutated Catalog internal state")
	}
	fns := cat.Functions()
	delete(fns, "required")
	if _, ok := cat.Functions()["required"]; !ok {
		t.Fatalf("mutating Functions() map mutated Catalog internal state")
	}
}
