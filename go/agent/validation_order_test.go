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

package agent_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// recordCatalogJSON declares "record", a function the agent may call with an argument
// of any shape, so payloads can nest values and function calls inside its arguments.
const recordCatalogJSON = `{
  "catalogId": "test/record",
  "protocolVersion": "1.0",
  "components": {},
  "functions": {
    "record": {
      "type": "object",
      "returnType": "void",
      "allowedCallers": "rendererOrAgent",
      "properties": {
        "@call": {"const": "record"},
        "args": {
          "type": "object",
          "properties": {"value": {}},
          "required": ["value"],
          "unevaluatedProperties": false
        }
      },
      "required": ["@call", "args"]
    }
  }
}`

// TestValidationErrorsNameKeysInSortedOrder checks that a payload with several
// unrecognized or invalid keys always gets the same error, which names the first
// offending key in sorted order rather than whichever key map iteration reaches first.
func TestValidationErrorsNameKeysInSortedOrder(t *testing.T) {
	cat, err := core.CatalogFromJSONBytes([]byte(recordCatalogJSON), nil)
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes: %v", err)
	}
	catalogs := []*core.Catalog{cat}
	parser, err := agent.NewDirectJSONParser(catalogs, nil)
	if err != nil {
		t.Fatalf("NewDirectJSONParser: %v", err)
	}
	accept := func(context.Context, *core.RendererToAgentMessage) (bool, error) { return true, nil }
	proc, err := agent.NewRendererToAgentMessageProcessor(catalogs, &agent.RendererToAgentOptions{
		OnAction:                   accept,
		OnError:                    accept,
		OnRendererFunctionResponse: accept,
	})
	if err != nil {
		t.Fatalf("NewRendererToAgentMessageProcessor: %v", err)
	}
	calls, err := agent.NewRendererFunctionCalls(nil)
	if err != nil {
		t.Fatalf("NewRendererFunctionCalls: %v", err)
	}

	// parse returns the error of parsing a callRendererFunction whose body is callBody.
	parse := func(callBody string) func() string {
		return func() string {
			content := `<a2ui-json>{"version":"1.0","callRendererFunction":` + callBody + `}</a2ui-json>`
			_, err := parser.ParseResponse(content, nil)
			return fmt.Sprint(err)
		}
	}
	// record returns the error of an agent call to "record" with the given value argument.
	record := func(value string) func() string {
		return parse(`{"functionCallId":"c1","callFunction":{"@call":"record","catalogId":"test/record","args":{"value":` + value + `}}}`)
	}
	// process returns the error, or else the JSON replies, of processing a renderer message.
	process := func(raw string) func() string {
		return func() string {
			var msg map[string]any
			if err := json.Unmarshal([]byte(raw), &msg); err != nil {
				return fmt.Sprintf("json.Unmarshal(%s): %v", raw, err)
			}
			res, err := proc.ProcessMessageMap(context.Background(), msg)
			if err != nil {
				return err.Error()
			}
			replies, err := json.Marshal(res.Replies)
			if err != nil {
				return fmt.Sprintf("json.Marshal(%#v): %v", res.Replies, err)
			}
			return string(replies)
		}
	}
	callID := "c1"
	callRenderer := func(args map[string]any) func() string {
		return func() string {
			_, _, err := calls.Call(agent.CallRendererRequest{CatalogID: "test/record", Name: "record", Args: args, FunctionCallID: &callID})
			return fmt.Sprint(err)
		}
	}

	tests := []struct {
		name string
		run  func() string
		want string
	}{
		{
			name: "callRendererFunction field",
			run:  parse(`{"functionCallId":"c1","y":1,"x":2}`),
			want: `unrecognized field "x" in callRendererFunction`,
		},
		{
			name: "callFunction field",
			run:  parse(`{"functionCallId":"c1","callFunction":{"@call":"record","b":1,"a":2}}`),
			want: "has unrecognized field 'a' on callFunction",
		},
		{
			name: "reserved directive in an argument",
			run:  record(`{"@y":1,"@x":2}`),
			want: `unrecognized reserved '@' directive "@x"`,
		},
		{
			name: "data binding field",
			run:  record(`{"@path":"/v","y":1,"x":2}`),
			want: "data binding with unrecognized field 'x'",
		},
		{
			name: "nested argument values",
			run:  record(`{"b":{"@y":1},"a":{"@x":1}}`),
			want: `unrecognized reserved '@' directive "@x"`,
		},
		{
			name: "nested function call field",
			run:  record(`{"@call":"record","y":1,"x":2}`),
			want: "holds a call to 'record' with unrecognized field 'x'",
		},
		{
			name: "renderer capabilities property",
			run: func() string {
				_, err := agent.ReadRendererCapabilities(map[string]any{
					agent.RendererCapabilitiesKey: map[string]any{
						"1.0": map[string]any{"supportedCatalogIds": []any{}, "z": 1, "y": 2, "x": 3},
					},
				}, core.Version1_0)
				return fmt.Sprint(err)
			},
			want: "unrecognized capabilities property: x",
		},
		{
			name: "renderer capabilities entry",
			run: func() string {
				_, err := agent.ParseRendererCapabilities(map[string]any{"v0.9": "bad", "1.0": "bad"})
				return fmt.Sprint(err)
			},
			want: `invalid "1.0" renderer capabilities`,
		},
		{
			name: "renderer capabilities entry property",
			run: func() string {
				_, err := agent.ParseRendererCapabilities(map[string]any{
					"1.0": map[string]any{"supportedCatalogIds": []any{}, "z": 1, "y": 2, "x": 3},
				})
				return fmt.Sprint(err)
			},
			want: "unrecognized capabilities property: x",
		},
		{
			name: "callAgentFunction field",
			run:  process(`{"version":"1.0","callAgentFunction":{"functionCallId":"c1","y":1,"x":2}}`),
			want: `unrecognized field \"x\" on callAgentFunction`,
		},
		{
			name: "callAgentFunction callFunction field",
			run:  process(`{"version":"1.0","callAgentFunction":{"functionCallId":"c1","surfaceId":"s1","callFunction":{"@call":"record","y":1,"x":2}}}`),
			want: `unrecognized field \"x\" on callFunction`,
		},
		{
			name: "action field",
			run:  process(`{"version":"1.0","action":{"name":"go","y":1,"x":2}}`),
			want: `unrecognized field "x" in action message`,
		},
		{
			name: "validation error field",
			run:  process(`{"version":"1.0","error":{"code":"VALIDATION_FAILED","message":"m","y":1,"x":2}}`),
			want: `validation error message has unrecognized field "x"`,
		},
		{
			name: "rendererFunctionResponse field",
			run:  process(`{"version":"1.0","rendererFunctionResponse":{"functionCallId":"c1","y":1,"x":2}}`),
			want: `unrecognized field "x" in rendererFunctionResponse`,
		},
		{
			name: "FunctionResponseError field",
			run:  process(`{"version":"1.0","rendererFunctionResponse":{"functionCallId":"c1","error":{"code":"c","message":"m","y":1,"x":2}}}`),
			want: `unrecognized field "x" in FunctionResponseError`,
		},
		{
			name: "renderer call argument key",
			run:  callRenderer(map[string]any{"9y": 1, "8x": 2}),
			want: `the key "8x" is not a UAX #31 identifier`,
		},
		{
			name: "renderer call argument value",
			run:  callRenderer(map[string]any{"b": math.Inf(1), "a": map[string]any{"q": math.NaN(), "p": math.Inf(-1)}}),
			want: `"a.p" is -Inf`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			first := tc.run()
			if !strings.Contains(first, tc.want) {
				t.Fatalf("got %q, want it to contain %q", first, tc.want)
			}
			// Map iteration order is randomized per loop, so repeated runs catch an
			// error that depends on it.
			for i := 1; i <= 20; i++ {
				if got := tc.run(); got != first {
					t.Fatalf("run %d got %q, want %q as in run 0", i, got, first)
				}
			}
		})
	}
}
