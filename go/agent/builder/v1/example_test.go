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
	"encoding/json"
	"fmt"
	"log"

	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
)

func ExampleCreateSurface() {
	msg, err := v1.CreateSurface(v1.CreateSurfaceOptions{
		SurfaceID: "main",
		CatalogID: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
	})
	if err != nil {
		log.Fatal(err)
	}
	out, _ := json.Marshal(msg)
	fmt.Println(string(out))
	// Output:
	// {"createSurface":{"catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","surfaceId":"main"},"version":"1.0"}
}

func ExampleUpdateComponentsFromTree() {
	form := v1.NewColumn(v1.Children(
		v1.NewTextField(v1.Str("Email"), v1.Bind("/form/email")).
			WithChecks(v1.NewCheckRule(v1.Email(v1.Bind("/form/email")), "Enter a valid email")),
		v1.NewButton(v1.NewText(v1.Str("Submit")), v1.EventAction("submit", map[string]v1.DynamicValue{
			"email": v1.Bind("/form/email"),
		})).WithVariant(v1.ButtonVariantPrimary),
	))

	msg, err := v1.UpdateComponentsFromTree("main", form, "root")
	if err != nil {
		log.Fatal(err)
	}
	body := msg["updateComponents"].(map[string]any)
	fmt.Println("version:", msg["version"], "surfaceId:", body["surfaceId"])
	for _, c := range body["components"].([]any) {
		line, _ := json.Marshal(c)
		fmt.Println(string(line))
	}
	// Output:
	// version: 1.0 surfaceId: main
	// {"@checks":[{"condition":{"@call":"email","args":{"value":{"@path":"/form/email"}}},"message":"Enter a valid email"}],"component":"TextField","id":"root__textfield_1","label":"Email","value":{"@path":"/form/email"},"variant":"shortText"}
	// {"component":"Text","id":"root__text_1","text":"Submit","variant":"body"}
	// {"action":{"event":{"context":{"email":{"@path":"/form/email"}},"name":"submit"}},"child":"root__text_1","component":"Button","id":"root__button_1","variant":"primary"}
	// {"align":"stretch","children":["root__textfield_1","root__button_1"],"component":"Column","id":"root","justify":"start"}
}
