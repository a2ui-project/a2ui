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

package core

import (
	"strings"
	"testing"
)

// TestValidateComponentChecksV10 checks that v1.0 check rules are validated against the
// CheckRule schema under the @checks key and under the legacy bare checks key.
func TestValidateComponentChecksV10(t *testing.T) {
	validator := NewPayloadValidator(MustBasicCatalog(Version1_0), nil)
	validRule := map[string]any{
		"condition": map[string]any{"@call": "required", "args": map[string]any{"value": map[string]any{"@path": "/name"}}},
		"message":   "Required",
	}
	invalidRule := map[string]any{"condition": "not a binding or call", "message": 42}

	for _, key := range []string{"@checks", "checks"} {
		t.Run(key, func(t *testing.T) {
			field := func(rules ...any) map[string]any {
				return map[string]any{
					"id":        "name",
					"component": "TextField",
					"label":     "Name",
					"value":     map[string]any{"@path": "/name"},
					key:         rules,
				}
			}
			if err := validator.ValidateComponent(field(validRule), "s1"); err != nil {
				t.Errorf("ValidateComponent(valid %s) = %v, want nil", key, err)
			}
			err := validator.ValidateComponent(field(invalidRule), "s1")
			if err == nil {
				t.Fatalf("ValidateComponent(invalid %s) = nil, want an error", key)
			}
			if !strings.Contains(err.Error(), "components.name."+key) {
				t.Errorf("ValidateComponent(invalid %s) error %q does not point at components.name.%s", key, err, key)
			}
		})
	}
}
