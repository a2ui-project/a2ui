package v091

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestFlightStatusMessages(t *testing.T) {
	data, err := os.ReadFile(basicExamplesDir + "/01_flight-status.json")
	if err != nil {
		t.Fatal(err)
	}

	var example struct {
		Name        string            `json:"name"`
		Description string            `json:"description"`
		Messages    []json.RawMessage `json:"messages"`
	}
	if err := json.Unmarshal(data, &example); err != nil {
		t.Fatal(err)
	}
	if len(example.Messages) != 3 {
		t.Fatalf("got %d messages, want 3", len(example.Messages))
	}

	tests := []struct {
		name      string
		index     int
		wantField string
	}{
		{"CreateSurface", 0, "createSurface"},
		{"UpdateComponents", 1, "updateComponents"},
		{"UpdateDataModel", 2, "updateDataModel"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg ServerMessage
			if err := json.Unmarshal(example.Messages[tt.index], &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Version != Version {
				t.Fatalf("version = %q, want %q", msg.Version, Version)
			}
			switch tt.wantField {
			case "createSurface":
				if msg.CreateSurface == nil {
					t.Fatal("CreateSurface is nil")
				}
				if msg.CreateSurface.SurfaceID != "gallery-flight-status" {
					t.Fatalf("surfaceId = %q", msg.CreateSurface.SurfaceID)
				}
			case "updateComponents":
				if msg.UpdateComponents == nil {
					t.Fatal("UpdateComponents is nil")
				}
				if len(msg.UpdateComponents.Components) == 0 {
					t.Fatal("no components")
				}
			case "updateDataModel":
				if msg.UpdateDataModel == nil {
					t.Fatal("UpdateDataModel is nil")
				}
			}

			// Round-trip: marshal and compare JSON equivalence.
			jsonEquivalent(t, example.Messages[tt.index], msg)
		})
	}
}

func TestServerMessageRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		msg  ServerMessage
	}{
		{
			name: "create_surface",
			msg: ServerMessage{
				Version: Version,
				CreateSurface: &CreateSurface{
					SurfaceID: "test-1",
					CatalogID: "https://example.com/catalog.json",
				},
			},
		},
		{
			name: "delete_surface",
			msg: ServerMessage{
				Version:       Version,
				DeleteSurface: &DeleteSurface{SurfaceID: "test-1"},
			},
		},
		{
			name: "update_data_model",
			msg: ServerMessage{
				Version: Version,
				UpdateDataModel: &UpdateDataModel{
					SurfaceID: "test-1",
					Path:      "/count",
					Value:     float64(42),
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ServerMessage
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.msg) {
				t.Fatalf("round-trip mismatch:\n  got:  %+v\n  want: %+v", got, tt.msg)
			}
		})
	}
}

func TestClientMessageRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		msg  ClientMessage
	}{
		{
			name: "action",
			msg: ClientMessage{
				Version: Version,
				Action: &ActionEvent{
					Name:              "submit",
					SurfaceID:         "test-1",
					SourceComponentID: "btn-1",
					Timestamp:         "2025-01-01T00:00:00Z",
					Context:           map[string]any{"key": "value"},
				},
			},
		},
		{
			name: "error",
			msg: ClientMessage{
				Version: Version,
				Error: &ClientError{
					Code:      "INVALID_SURFACE",
					SurfaceID: "test-1",
					Message:   "surface not found",
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ClientMessage
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tt.msg) {
				t.Fatalf("round-trip mismatch:\n  got:  %+v\n  want: %+v", got, tt.msg)
			}
		})
	}
}

func TestServerMessageRejectsInvalidPayloadCounts(t *testing.T) {
	tests := []struct {
		name string
		msg  ServerMessage
	}{
		{
			name: "none",
			msg:  ServerMessage{Version: Version},
		},
		{
			name: "multiple",
			msg: ServerMessage{
				Version:       Version,
				CreateSurface: &CreateSurface{SurfaceID: "s1", CatalogID: "cat"},
				DeleteSurface: &DeleteSurface{SurfaceID: "s1"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := json.Marshal(tt.msg); err == nil {
				t.Fatal("expected marshal error, got nil")
			}
		})
	}
	for _, raw := range []string{
		`{"version":"v0.9.1"}`,
		`{"version":"v0.9.1","createSurface":{"surfaceId":"s1","catalogId":"cat"},"deleteSurface":{"surfaceId":"s1"}}`,
	} {
		var msg ServerMessage
		if err := json.Unmarshal([]byte(raw), &msg); err == nil {
			t.Fatalf("expected unmarshal error for %s", raw)
		}
	}
}

func TestClientMessageRejectsInvalidPayloadCounts(t *testing.T) {
	tests := []struct {
		name string
		msg  ClientMessage
	}{
		{
			name: "none",
			msg:  ClientMessage{Version: Version},
		},
		{
			name: "multiple",
			msg: ClientMessage{
				Version: Version,
				Action:  &ActionEvent{Name: "submit", SurfaceID: "s1", SourceComponentID: "btn", Timestamp: "2025-01-01T00:00:00Z"},
				Error:   &ClientError{Code: "ERR", SurfaceID: "s1", Message: "bad"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := json.Marshal(tt.msg); err == nil {
				t.Fatal("expected marshal error, got nil")
			}
		})
	}
	for _, raw := range []string{
		`{"version":"v0.9.1"}`,
		`{"version":"v0.9.1","action":{"name":"submit","surfaceId":"s1","sourceComponentId":"btn","timestamp":"2025-01-01T00:00:00Z"},"error":{"code":"ERR","surfaceId":"s1","message":"bad"}}`,
	} {
		var msg ClientMessage
		if err := json.Unmarshal([]byte(raw), &msg); err == nil {
			t.Fatalf("expected unmarshal error for %s", raw)
		}
	}
}

func TestServerMessageListWrapper(t *testing.T) {
	wrapper := ServerMessageListWrapper{
		Messages: []ServerMessage{
			{
				Version:       Version,
				CreateSurface: &CreateSurface{SurfaceID: "s1", CatalogID: "cat"},
			},
			{
				Version:       Version,
				DeleteSurface: &DeleteSurface{SurfaceID: "s1"},
			},
		},
	}
	data, err := json.Marshal(wrapper)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got ServerMessageListWrapper
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(got, wrapper) {
		t.Fatalf("round-trip mismatch\n  got:  %+v\n  want: %+v", got, wrapper)
	}
}

func TestClientMessageListWrapperEmpty(t *testing.T) {
	data := []byte(`{"messages":[]}`)
	var w ClientMessageListWrapper
	if err := json.Unmarshal(data, &w); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(w.Messages) != 0 {
		t.Fatalf("got %d messages, want 0", len(w.Messages))
	}
}

// jsonEquivalent marshals v and checks that the result is semantically
// equivalent to the original JSON. Empty maps/objects and missing fields
// are treated as equivalent (omitempty normalization).
func jsonEquivalent(t *testing.T, original json.RawMessage, v any) {
	t.Helper()
	remarshaled, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("re-marshal: %v", err)
	}
	var got, want any
	if err := json.Unmarshal(remarshaled, &got); err != nil {
		t.Fatalf("unmarshal re-marshaled: %v", err)
	}
	if err := json.Unmarshal(original, &want); err != nil {
		t.Fatalf("unmarshal original: %v", err)
	}
	normalizeJSON(got)
	normalizeJSON(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("JSON not equivalent:\n  got:  %s\n  want: %s", remarshaled, original)
	}
}

// normalizeJSON removes empty maps and nil values in-place so that
// omitempty differences don't cause false mismatches.
func normalizeJSON(v any) {
	switch v := v.(type) {
	case map[string]any:
		for k, val := range v {
			normalizeJSON(val)
			// Remove keys whose value is an empty map (matches omitempty behavior).
			if m, ok := val.(map[string]any); ok && len(m) == 0 {
				delete(v, k)
			}
		}
	case []any:
		for _, elem := range v {
			normalizeJSON(elem)
		}
	}
}
