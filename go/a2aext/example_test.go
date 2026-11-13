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

package a2aext_test

import (
	"context"
	"fmt"
	"iter"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func ExampleActivateExtension() {
	card := &a2a.AgentCard{
		Capabilities: a2a.AgentCapabilities{
			Extensions: []a2a.AgentExtension{
				a2aext.AgentExtension(core.Version0_9, nil),
				a2aext.AgentExtension(core.Version1_0, &a2aext.AgentExtensionOptions{
					SupportedCatalogIDs: []string{
						"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
					},
				}),
			},
		},
	}

	msg := a2a.NewMessage(a2a.MessageRoleUser, a2a.TextPart{Text: "Show me a card"})
	msg.Extensions = []string{a2aext.ExtensionURI(core.Version1_0)}

	version, ok := a2aext.ActivateExtension(nil, msg, card)
	fmt.Println(ok, version)
	// Output: true 1.0
}

func ExampleStreamResponseToParts() {
	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		panic(err)
	}
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, nil)
	if err != nil {
		panic(err)
	}
	stream, err := proc.OpenStream(nil)
	if err != nil {
		panic(err)
	}

	tokens := iter.Seq2[string, error](func(yield func(string, error) bool) {
		chunks := []string{
			"Here is your card:\n<a2ui>\n",
			"surface(\"main\")\nroot = Text(\"Hello, A2UI!\")\n</a2ui>",
		}
		for _, c := range chunks {
			if !yield(c, nil) {
				return
			}
		}
	})

	var a2uiCount int
	for part, err := range a2aext.StreamResponseToParts(context.Background(), stream, tokens, core.Version1_0) {
		if err != nil {
			panic(err)
		}
		if a2aext.IsA2UIPart(part) {
			a2uiCount++
		}
	}
	fmt.Println(a2uiCount)
	// Output: 1
}
