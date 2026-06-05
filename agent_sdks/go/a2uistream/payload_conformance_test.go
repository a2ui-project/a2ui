package a2uistream

import (
	"reflect"
	"testing"
)

func TestPayloadConformance(t *testing.T) {
	for _, tc := range payloadConformanceCases() {
		t.Run(tc.name, func(t *testing.T) {
			switch tc.action {
			case "parse_full":
				got, err := ParseResponse(tc.input)
				if tc.wantErr != "" {
					if err == nil {
						t.Fatalf("ParseResponse succeeded, want error matching %q", tc.wantErr)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got, tc.wantParts) {
					t.Fatalf("ParseResponse = %#v, want %#v", got, tc.wantParts)
				}
			case "has_parts":
				if got := HasParts(tc.input); got != tc.wantHasParts {
					t.Fatalf("HasParts = %v, want %v", got, tc.wantHasParts)
				}
			case "fix_payload":
				got, err := FixPayload(tc.input)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got, tc.wantPayload) {
					t.Fatalf("FixPayload = %#v, want %#v", got, tc.wantPayload)
				}
			default:
				t.Fatalf("unsupported action %q", tc.action)
			}
		})
	}
}

type payloadConformanceCase struct {
	name         string
	action       string
	input        string
	wantErr      string
	wantParts    []PayloadPart
	wantHasParts bool
	wantPayload  []map[string]any
}

func payloadConformanceCases() []payloadConformanceCase {
	// These cases mirror the has_parts and fix_payload cases in
	// agent_sdks/conformance/suites/parser.yaml.
	return []payloadConformanceCase{
		{
			name:    "test_parse_empty_response",
			action:  "parse_full",
			input:   "",
			wantErr: "not found in response",
		},
		{
			name:    "test_parse_response_only_text_no_tags",
			action:  "parse_full",
			input:   "Only text, no tags.",
			wantErr: "not found in response",
		},
		{
			name:    "test_parse_response_empty_tags",
			action:  "parse_full",
			input:   "<a2ui-json></a2ui-json>",
			wantErr: "A2UI JSON part is empty",
		},
		{
			name:   "test_parse_response_only_json_with_tags",
			action: "parse_full",
			input:  `<a2ui-json>[{"id": "test"}]</a2ui-json>`,
			wantParts: []PayloadPart{
				{Payload: []map[string]any{{"id": "test"}}},
			},
		},
		{
			name:   "test_parse_response_with_text_and_tags",
			action: "parse_full",
			input:  "Hello\n<a2ui-json>[{\"id\": \"test\"}]</a2ui-json>",
			wantParts: []PayloadPart{
				{Text: "Hello", Payload: []map[string]any{{"id": "test"}}},
			},
		},
		{
			name:   "test_parse_response_with_trailing_text",
			action: "parse_full",
			input:  "Hello\n<a2ui-json>[{\"id\": \"test\"}]</a2ui-json>\nGoodbye",
			wantParts: []PayloadPart{
				{Text: "Hello", Payload: []map[string]any{{"id": "test"}}},
				{Text: "Goodbye"},
			},
		},
		{
			name:   "test_parse_response_multiple_blocks",
			action: "parse_full",
			input:  "Part 1\n<a2ui-json>\n[{\"id\": \"1\"}]\n</a2ui-json>\nPart 2\n<a2ui-json>\n[{\"id\": \"2\"}]\n</a2ui-json>\nPart 3",
			wantParts: []PayloadPart{
				{Text: "Part 1", Payload: []map[string]any{{"id": "1"}}},
				{Text: "Part 2", Payload: []map[string]any{{"id": "2"}}},
				{Text: "Part 3"},
			},
		},
		{
			name:   "test_parse_response_with_markdown_blocks",
			action: "parse_full",
			input:  "Text\n<a2ui-json>\n```json\n[{\"id\": \"test\"}]\n```\n</a2ui-json>",
			wantParts: []PayloadPart{
				{Text: "Text", Payload: []map[string]any{{"id": "test"}}},
			},
		},
		{
			name:    "test_parse_response_invalid_json",
			action:  "parse_full",
			input:   "<a2ui-json>\ninvalid_json\n</a2ui-json>",
			wantErr: "Failed to parse",
		},
		{
			name:         "test_has_a2ui_parts_true",
			action:       "has_parts",
			input:        "Hello <a2ui-json>[]</a2ui-json> World",
			wantHasParts: true,
		},
		{
			name:         "test_has_a2ui_parts_false_no_tags",
			action:       "has_parts",
			input:        "Hello World",
			wantHasParts: false,
		},
		{
			name:         "test_has_a2ui_parts_false_only_open",
			action:       "has_parts",
			input:        "Hello <a2ui-json> World",
			wantHasParts: false,
		},
		{
			name:        "test_fix_payload_trailing_comma_list",
			action:      "fix_payload",
			input:       `[{"type": "Text", "text": "Hello"},]`,
			wantPayload: []map[string]any{{"type": "Text", "text": "Hello"}},
		},
		{
			name:        "test_fix_payload_trailing_comma_object",
			action:      "fix_payload",
			input:       `{"type": "Text", "text": "Hello",}`,
			wantPayload: []map[string]any{{"type": "Text", "text": "Hello"}},
		},
		{
			name:        "test_fix_payload_auto_wrap",
			action:      "fix_payload",
			input:       `{"type": "Text", "text": "Hello"}`,
			wantPayload: []map[string]any{{"type": "Text", "text": "Hello"}},
		},
		{
			name:        "test_fix_payload_smart_quotes",
			action:      "fix_payload",
			input:       `{"type": “Text”, "other": "Value’s"}`,
			wantPayload: []map[string]any{{"type": "Text", "other": "Value's"}},
		},
		{
			name:        "test_fix_payload_commas_in_strings",
			action:      "fix_payload",
			input:       `{"text": "Hello, world", "array": ["a,b", "c"]}`,
			wantPayload: []map[string]any{{"text": "Hello, world", "array": []any{"a,b", "c"}}},
		},
	}
}
