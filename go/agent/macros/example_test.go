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
	"encoding/json"
	"fmt"
	"log"

	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/macros"
	"github.com/a2ui-project/a2ui/go/core"
)

// exampleBadgeArgs declares the macro's parameters. Struct tags set the wire name,
// description, allowed values and default of each parameter.
type exampleBadgeArgs struct {
	Label  string `json:"label" desc:"Badge text"`
	Status string `json:"status,omitempty" enum:"ok,warning,error" default:"ok"`
}

func newStatusBadge() *macros.Macro {
	return macros.MustNewPureMacro("StatusBadge", "A card showing a status label.", func(a exampleBadgeArgs) *v1.Card {
		return v1.NewCard(v1.NewRow(v1.Children(
			v1.NewIcon(v1.IconCheck),
			v1.NewText(v1.Str(a.Label+" ("+a.Status+")")),
		)))
	})
}

func ExampleNewPureMacro() {
	schema := newStatusBadge().ToJSONSchema(macros.SchemaOptions{})
	out, _ := json.MarshalIndent(schema, "", "  ")
	fmt.Println(string(out))
	// Output:
	// {
	//   "description": "A card showing a status label.",
	//   "properties": {
	//     "label": {
	//       "description": "Badge text",
	//       "type": "string"
	//     },
	//     "status": {
	//       "enum": [
	//         "ok",
	//         "warning",
	//         "error"
	//       ],
	//       "type": "string"
	//     }
	//   },
	//   "required": [
	//     "label"
	//   ],
	//   "type": "object"
	// }
}

func ExampleMacroExpander_TransformToTransport() {
	basic := core.MustBasicCatalog(core.Version1_0)
	exp, err := macros.NewMacroExpander([]*macros.Macro{newStatusBadge()}, &macros.ExpanderOptions{
		BaseCatalogs: []*core.Catalog{basic},
	})
	if err != nil {
		log.Fatal(err)
	}

	// The model writes the macro as if it were a catalog component.
	create, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: "main", CatalogID: basic.CatalogID()})
	if err != nil {
		log.Fatal(err)
	}
	update := v1.UpdateComponents("main", []map[string]any{
		{"id": "root", "component": "StatusBadge", "@catalogId": macros.DefaultMacroCatalogID, "label": "Build"},
	})

	lowered, err := exp.TransformToTransport([]core.AgentToRendererMessage{create, update})
	if err != nil {
		log.Fatal(err)
	}
	body := lowered[1]["updateComponents"].(map[string]any)
	for _, c := range body["components"].([]any) {
		line, _ := json.Marshal(c)
		fmt.Println(string(line))
	}
	// Output:
	// {"component":"Icon","id":"root__icon_1","name":"check"}
	// {"component":"Text","id":"root__text_1","text":"Build (ok)","variant":"body"}
	// {"align":"stretch","children":["root__icon_1","root__text_1"],"component":"Row","id":"root__row_1","justify":"start"}
	// {"child":"root__row_1","component":"Card","id":"root"}
}

func ExampleTransportSession() {
	basic := core.MustBasicCatalog(core.Version1_0)
	exp, err := macros.NewMacroExpander([]*macros.Macro{newStatusBadge()}, &macros.ExpanderOptions{
		BaseCatalogs: []*core.Catalog{basic},
	})
	if err != nil {
		log.Fatal(err)
	}

	// Share exp across the server and create one session per conversation.
	session := exp.NewSession()

	// Turn 1 creates a v1.0 surface without a default catalog.
	create, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: "main"})
	if err != nil {
		log.Fatal(err)
	}
	if _, err := session.TransformToTransport([]core.AgentToRendererMessage{create}); err != nil {
		log.Fatal(err)
	}

	// Turn 2 updates it. The session remembers the surface has no default catalog,
	// so every lowered primitive gets its owning catalogId.
	update := v1.UpdateComponents("main", []map[string]any{
		{"id": "root", "component": "StatusBadge", "@catalogId": macros.DefaultMacroCatalogID, "label": "Deploy"},
	})
	lowered, err := session.TransformToTransport([]core.AgentToRendererMessage{update})
	if err != nil {
		log.Fatal(err)
	}
	body := lowered[0]["updateComponents"].(map[string]any)
	for _, c := range body["components"].([]any) {
		comp := c.(map[string]any)
		fmt.Println(comp["id"], comp["component"], comp["@catalogId"])
	}
	// Output:
	// root__icon_1 Icon https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json
	// root__text_1 Text https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json
	// root__row_1 Row https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json
	// root Card https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json
}
