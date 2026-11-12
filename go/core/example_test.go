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
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/a2ui-project/a2ui/go/core"
)

// This example validates and applies a v1.0 createSurface message against the basic catalog,
// then reads the surface's data model.
func ExampleMessageProcessor() {
	catalog, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		log.Fatal(err)
	}
	strict := core.StrictValidation()
	processor, err := core.NewMessageProcessor([]*core.Catalog{catalog}, &core.MessageProcessorOptions{
		ValidationConfig: &strict,
	})
	if err != nil {
		log.Fatal(err)
	}

	err = processor.ProcessMessages([]core.AgentToRendererMessage{{
		"version": "1.0",
		"createSurface": map[string]any{
			"surfaceId": "main",
			"catalogId": catalog.CatalogID(),
			"dataModel": map[string]any{"user": map[string]any{"name": "Ada"}},
			"components": []any{
				map[string]any{"id": "root", "component": "Text", "text": map[string]any{"@path": "/user/name"}},
			},
		},
	}}, nil)
	var validationErr *core.ValidationError
	if errors.As(err, &validationErr) {
		log.Fatalf("message rejected at %s: %v", validationErr.Path, validationErr)
	} else if err != nil {
		log.Fatal(err)
	}

	name, _, _ := processor.Model.Surface("main").DataModel.Get("/user/name")
	fmt.Println(name)
	// Output: Ada
}

// This example shows a strict processor rejecting a component that names an unknown property,
// and the protocol error envelope that would be sent back to the agent.
func ExampleMessageProcessor_validationError() {
	strict := core.StrictValidation()
	var sent map[string]any
	processor, err := core.NewMessageProcessor([]*core.Catalog{core.MustBasicCatalog(core.Version1_0)}, &core.MessageProcessorOptions{
		ValidationConfig: &strict,
		ErrorHandler:     func(envelope map[string]any) { sent = envelope },
	})
	if err != nil {
		log.Fatal(err)
	}

	err = processor.ProcessPayload([]any{
		map[string]any{"version": "1.0", "createSurface": map[string]any{
			"surfaceId": "main",
			"catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
		}},
		map[string]any{"version": "1.0", "updateComponents": map[string]any{
			"surfaceId":  "main",
			"components": []any{map[string]any{"id": "root", "component": "Text", "text": "Hi", "colour": "red"}},
		}},
	}, nil)
	var validationErr *core.ValidationError
	fmt.Println(errors.As(err, &validationErr))
	body := sent["error"].(map[string]any)
	fmt.Println(body["code"], body["path"])
	// Output:
	// true
	// VALIDATION_FAILED /components/0/colour
}

// This example extends the built-in v1.0 basic catalog with an agent-side function using CopyWith.
func ExampleCatalog_CopyWith() {
	base := core.MustBasicCatalog(core.Version1_0)
	extended, err := base.CopyWith(core.CopyWithOptions{
		CatalogID: "https://example.com/catalogs/shop/v1/catalog.json",
		AgentFunctions: []*core.AgentFunction{{
			Name:        "lookupStock",
			Description: "Returns available inventory for a SKU.",
			ReturnType:  core.ReturnTypeNumber,
			ArgsSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"sku": map[string]any{"type": "string"}},
				"required":   []any{"sku"},
			},
			Handler: func(_ context.Context, args map[string]any, _ core.AgentFunctionContext) (any, error) {
				return 12, nil
			},
		}},
	})
	if err != nil {
		log.Fatal(err)
	}

	_, inBase := base.AgentFunctions()["lookupStock"]
	fn, inExtended := extended.AgentFunctions()["lookupStock"]
	fmt.Println(inBase, inExtended, fn.ReturnType)
	// Output: false true number
}

// This example watches an RFC 6901 JSON Pointer in a DataModel across auto-vivifying writes and key deletion.
func ExampleDataModel() {
	dm := core.NewDataModel(nil)
	var seen []any
	stop, err := dm.Watch("/cart/total", func(val any) {
		seen = append(seen, val)
	})
	if err != nil {
		log.Fatal(err)
	}
	defer stop()

	if err := dm.Set("/cart/total", 25); err != nil {
		log.Fatal(err)
	}
	val, ok, _ := dm.Get("/cart/total")
	fmt.Println(val, ok)

	if err := dm.Set("/cart/total", nil); err != nil {
		log.Fatal(err)
	}
	_, ok, _ = dm.Get("/cart/total")
	fmt.Println(ok, len(seen))
	// Output:
	// 25 true
	// false 2
}
