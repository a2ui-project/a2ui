package v09

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDynamicString(t *testing.T) {
	tests := []struct {
		name string
		json string
		want DynamicString
	}{
		{
			name: "literal",
			json: `"hello"`,
			want: StringLiteral("hello"),
		},
		{
			name: "binding",
			json: `{"path":"/foo"}`,
			want: StringBinding("/foo"),
		},
		{
			name: "function_call",
			json: `{"call":"formatString","args":{"value":"hi"},"returnType":"string"}`,
			want: StringFunc(FunctionCall{
				Call:       "formatString",
				Args:       map[string]any{"value": "hi"},
				ReturnType: ReturnTypeString,
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got DynamicString
			if err := json.Unmarshal([]byte(tt.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			roundTrip(t, got, tt.json)
		})
	}
}

func TestDynamicNumber(t *testing.T) {
	tests := []struct {
		name string
		json string
		want DynamicNumber
	}{
		{
			name: "literal",
			json: `42.5`,
			want: NumberLiteral(42.5),
		},
		{
			name: "integer",
			json: `100`,
			want: NumberLiteral(100),
		},
		{
			name: "binding",
			json: `{"path":"/count"}`,
			want: NumberBinding("/count"),
		},
		{
			name: "function_call",
			json: `{"call":"add","args":{"a":1,"b":2},"returnType":"number"}`,
			want: NumberFunc(FunctionCall{
				Call:       "add",
				Args:       map[string]any{"a": float64(1), "b": float64(2)},
				ReturnType: ReturnTypeNumber,
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got DynamicNumber
			if err := json.Unmarshal([]byte(tt.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			roundTrip(t, got, tt.json)
		})
	}
}

func TestDynamicBoolean(t *testing.T) {
	tests := []struct {
		name string
		json string
		want DynamicBoolean
	}{
		{
			name: "true",
			json: `true`,
			want: BoolLiteral(true),
		},
		{
			name: "false",
			json: `false`,
			want: BoolLiteral(false),
		},
		{
			name: "binding",
			json: `{"path":"/enabled"}`,
			want: BoolBinding("/enabled"),
		},
		{
			name: "function_call",
			json: `{"call":"required","args":{"value":"x"},"returnType":"boolean"}`,
			want: BoolFunc(FunctionCall{
				Call:       "required",
				Args:       map[string]any{"value": "x"},
				ReturnType: ReturnTypeBoolean,
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got DynamicBoolean
			if err := json.Unmarshal([]byte(tt.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			roundTrip(t, got, tt.json)
		})
	}
}

func TestDynamicStringList(t *testing.T) {
	tests := []struct {
		name string
		json string
		want DynamicStringList
	}{
		{
			name: "literal",
			json: `["a","b"]`,
			want: StringListLiteral([]string{"a", "b"}),
		},
		{
			name: "binding",
			json: `{"path":"/tags"}`,
			want: StringListBinding("/tags"),
		},
		{
			name: "function_call",
			json: `{"call":"split","args":{"sep":","},"returnType":"array"}`,
			want: StringListFunc(FunctionCall{
				Call:       "split",
				Args:       map[string]any{"sep": ","},
				ReturnType: ReturnTypeArray,
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got DynamicStringList
			if err := json.Unmarshal([]byte(tt.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			roundTrip(t, got, tt.json)
		})
	}
}

func TestDynamicValue(t *testing.T) {
	tests := []struct {
		name string
		json string
		want DynamicValue
	}{
		{
			name: "string",
			json: `"hello"`,
			want: ValueString("hello"),
		},
		{
			name: "number",
			json: `3.14`,
			want: ValueNumber(3.14),
		},
		{
			name: "bool_true",
			json: `true`,
			want: ValueBool(true),
		},
		{
			name: "bool_false",
			json: `false`,
			want: ValueBool(false),
		},
		{
			name: "array",
			json: `[1,"two",true]`,
			want: ValueArray([]any{float64(1), "two", true}),
		},
		{
			name: "binding",
			json: `{"path":"/data"}`,
			want: ValueBinding("/data"),
		},
		{
			name: "function_call",
			json: `{"call":"now","returnType":"string"}`,
			want: ValueFunc(FunctionCall{
				Call:       "now",
				ReturnType: ReturnTypeString,
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got DynamicValue
			if err := json.Unmarshal([]byte(tt.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			roundTrip(t, got, tt.json)
		})
	}
}

func TestDynamicMarshalEmpty(t *testing.T) {
	tests := []struct {
		name string
		fn   func() ([]byte, error)
	}{
		{"DynamicString", func() ([]byte, error) { return json.Marshal(DynamicString{}) }},
		{"DynamicNumber", func() ([]byte, error) { return json.Marshal(DynamicNumber{}) }},
		{"DynamicBoolean", func() ([]byte, error) { return json.Marshal(DynamicBoolean{}) }},
		{"DynamicStringList", func() ([]byte, error) { return json.Marshal(DynamicStringList{}) }},
		{"DynamicValue", func() ([]byte, error) { return json.Marshal(DynamicValue{}) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.fn()
			if err == nil {
				t.Fatal("expected error for zero-value marshal, got nil")
			}
		})
	}
}

func TestDynamicRejectsMultipleValues(t *testing.T) {
	s := "hello"
	tests := []struct {
		name  string
		value any
	}{
		{"DynamicString", DynamicString{Literal: &s, Binding: &DataBinding{Path: "/name"}}},
		{"DynamicNumber", DynamicNumber{Literal: float64Ptr(42), Binding: &DataBinding{Path: "/count"}}},
		{"DynamicBoolean", DynamicBoolean{Literal: boolPtr(true), Binding: &DataBinding{Path: "/enabled"}}},
		{"DynamicStringList", DynamicStringList{Literal: []string{"a"}, Binding: &DataBinding{Path: "/tags"}}},
		{"DynamicValue", DynamicValue{String: &s, Binding: &DataBinding{Path: "/value"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := json.Marshal(tt.value); err == nil {
				t.Fatal("expected marshal error, got nil")
			}
		})
	}
}

func TestDynamicRejectsAmbiguousObject(t *testing.T) {
	var got DynamicString
	if err := json.Unmarshal([]byte(`{"path":"/name","call":"formatString"}`), &got); err == nil {
		t.Fatal("expected unmarshal error, got nil")
	}
}

// roundTrip marshals v, then verifies the JSON is semantically equivalent to wantJSON.
func roundTrip(t *testing.T, v any, wantJSON string) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got, want any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal marshaled: %v", err)
	}
	if err := json.Unmarshal([]byte(wantJSON), &want); err != nil {
		t.Fatalf("unmarshal want: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round-trip mismatch:\n  got:  %s\n  want: %s", data, wantJSON)
	}
}

func boolPtr(v bool) *bool { return &v }

func float64Ptr(v float64) *float64 { return &v }
