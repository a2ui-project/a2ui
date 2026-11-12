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

package builder_test

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
)

func ExampleFlattenComponentTree() {
	card := v1.NewCard(v1.NewColumn(v1.Children(
		v1.NewText(v1.Str("Hello")),
		v1.NewButton(v1.NewText(v1.Str("Save")), v1.EventAction("save", nil)),
	)))

	components, err := builder.FlattenComponentTree(card, "root")
	if err != nil {
		log.Fatal(err)
	}
	for _, c := range components {
		line, _ := json.Marshal(c)
		fmt.Println(string(line))
	}
	// Output:
	// {"component":"Text","id":"root__text_1","text":"Hello","variant":"body"}
	// {"component":"Text","id":"root__text_2","text":"Save","variant":"body"}
	// {"action":{"event":{"name":"save"}},"child":"root__text_2","component":"Button","id":"root__button_1","variant":"default"}
	// {"align":"stretch","children":["root__text_1","root__button_1"],"component":"Column","id":"root__column_1","justify":"start"}
	// {"child":"root__column_1","component":"Card","id":"root"}
}

func ExampleComponentRef() {
	// A ComponentRef points at a component the agent already sent, so it is neither emitted nor renamed.
	row := v1.NewRow(v1.Children(builder.NewComponentRef("existing_header"), v1.NewDivider()))

	components, err := builder.FlattenComponentTree(row, "toolbar")
	if err != nil {
		log.Fatal(err)
	}
	for _, c := range components {
		line, _ := json.Marshal(c)
		fmt.Println(string(line))
	}
	// Output:
	// {"axis":"horizontal","component":"Divider","id":"toolbar__divider_1"}
	// {"align":"stretch","children":["existing_header","toolbar__divider_1"],"component":"Row","id":"toolbar","justify":"start"}
}
