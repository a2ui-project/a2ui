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

package v09_test

import (
	"reflect"
	"testing"

	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestV09SerializationAliasesAndEnvelopes(t *testing.T) {
	tf := v09.NewTextField(v09.Str("ZIP")).
		WithID("zip").
		WithValidationRegexp("^[0-9]{5}$").
		WithChecks(v09.NewCheckRule(v09.Bool(true), "Required"))

	flat, err := tf.Flatten("")
	if err != nil {
		t.Fatalf("tf.Flatten failed: %v", err)
	}
	if len(flat) != 1 || flat[0]["validationRegexp"] != "^[0-9]{5}$" {
		t.Fatalf("expected validationRegexp wire alias, got %#v", flat)
	}

	cs, err := v09.CreateSurface(v09.CreateSurfaceOptions{
		SurfaceID: "s_v091",
		CatalogID: "org.a2ui.basic",
		Version:   core.Version0_9_1,
	})
	if err != nil {
		t.Fatalf("CreateSurface(v0.9.1) failed: %v", err)
	}
	if cs["version"] != "v0.9.1" {
		t.Fatalf("expected version 'v0.9.1', got %v", cs["version"])
	}

	del := v09.DeleteSurface("s_v091")
	if !reflect.DeepEqual(del["deleteSurface"], map[string]any{"surfaceId": "s_v091"}) {
		t.Fatalf("unexpected v0.9 deleteSurface: %#v", del)
	}
}
