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
	"encoding/json"
	"fmt"
	"log"

	"github.com/a2ui-project/a2ui/go/agent/builder/v09"
)

func ExampleUpdateComponentsFromTree() {
	card := v09.NewCard(v09.NewColumn(v09.Children(
		v09.NewText(v09.Bind("/user/name")).WithVariant(v09.TextVariantH2),
		v09.NewButton(v09.NewText(v09.Str("Open")), v09.EventAction("open", nil)),
	)))

	msg, err := v09.UpdateComponentsFromTree("main", card, "root")
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
	// version: v0.9 surfaceId: main
	// {"component":"Text","id":"root__text_1","text":{"path":"/user/name"},"variant":"h2"}
	// {"component":"Text","id":"root__text_2","text":"Open","variant":"body"}
	// {"action":{"event":{"name":"open"}},"child":"root__text_2","component":"Button","id":"root__button_1","variant":"default"}
	// {"align":"stretch","children":["root__text_1","root__button_1"],"component":"Column","id":"root__column_1","justify":"start"}
	// {"child":"root__column_1","component":"Card","id":"root"}
}
