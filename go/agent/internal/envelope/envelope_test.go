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

package envelope

import "testing"

func TestKey(t *testing.T) {
	if got := Key("checks", true); got != "@checks" {
		t.Errorf("Key(checks, v1.0) = %q, want @checks", got)
	}
	if got := Key("checks", false); got != "checks" {
		t.Errorf("Key(checks, v0.9) = %q, want checks", got)
	}
}

func TestReadKey(t *testing.T) {
	tests := []struct {
		name       string
		component  map[string]any
		atLeastV10 bool
		custom     map[string]bool
		wantKey    string
		wantOK     bool
	}{
		{"v1.0 prefers the @ key", map[string]any{"@checks": 1, "checks": 2}, true, nil, "@checks", true},
		{"v1.0 falls back to the bare key", map[string]any{"checks": 2}, true, nil, "checks", true},
		{"v1.0 ignores a custom bare key", map[string]any{"checks": 2}, true, map[string]bool{"checks": true}, "", false},
		{"v0.9 reads the bare key", map[string]any{"checks": 2}, false, nil, "checks", true},
		{"v0.9 ignores the @ key", map[string]any{"@checks": 1}, false, nil, "", false},
		{"missing", map[string]any{}, true, nil, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			key, ok := ReadKey(tc.component, "checks", tc.atLeastV10, tc.custom)
			if key != tc.wantKey || ok != tc.wantOK {
				t.Errorf("ReadKey() = (%q, %t), want (%q, %t)", key, ok, tc.wantKey, tc.wantOK)
			}
		})
	}
}

func TestValue(t *testing.T) {
	comp := map[string]any{"@accessibility": map[string]any{"label": "a"}, "metadata": "bare"}
	if got := Value(comp, "accessibility", true, nil); got == nil {
		t.Error("Value(accessibility) = nil, want the @accessibility value")
	}
	if got := Value(comp, "metadata", true, map[string]bool{"metadata": true}); got != nil {
		t.Errorf("Value(metadata) = %v, want nil for a custom bare property", got)
	}
}

func TestIsEnvelopeKey(t *testing.T) {
	tests := []struct {
		key        string
		atLeastV10 bool
		custom     map[string]bool
		want       bool
	}{
		{"@checks", true, nil, true},
		{"@checks", false, nil, false},
		{"checks", true, nil, true},
		{"checks", true, map[string]bool{"checks": true}, false},
		{"id", true, nil, false},
		{"text", true, nil, false},
	}
	for _, tc := range tests {
		if got := IsEnvelopeKey(tc.key, tc.atLeastV10, tc.custom); got != tc.want {
			t.Errorf("IsEnvelopeKey(%q, %t, %v) = %t, want %t", tc.key, tc.atLeastV10, tc.custom, got, tc.want)
		}
	}
}
