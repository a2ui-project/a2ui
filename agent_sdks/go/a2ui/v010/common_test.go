package v010

import (
	"encoding/json"
	"testing"
)

func TestActionRejectsInvalidStates(t *testing.T) {
	action := Action{
		Event:        &EventAction{Name: "submit"},
		FunctionCall: &FunctionCall{Call: "openUrl"},
	}
	if _, err := json.Marshal(action); err == nil {
		t.Fatal("expected marshal error, got nil")
	}

	var decoded Action
	if err := json.Unmarshal([]byte(`{"event":{"name":"submit"},"functionCall":{"call":"openUrl"}}`), &decoded); err == nil {
		t.Fatal("expected unmarshal error, got nil")
	}
}

func TestIconNameOrPathRejectsInvalidStates(t *testing.T) {
	path := "/tmp/icon.svg"
	name := IconSearch
	icon := IconNameOrPath{Name: &name, Path: &path}
	if _, err := json.Marshal(icon); err == nil {
		t.Fatal("expected marshal error, got nil")
	}

	var decoded IconNameOrPath
	if err := json.Unmarshal([]byte(`{"path":""}`), &decoded); err == nil {
		t.Fatal("expected unmarshal error, got nil")
	}
}

func TestChildListRejectsMultipleRepresentations(t *testing.T) {
	children := ChildList{
		IDs:      []string{"a"},
		Template: &ChildTemplate{ComponentID: "child", Path: "/items"},
	}
	if _, err := json.Marshal(children); err == nil {
		t.Fatal("expected marshal error, got nil")
	}
}

func TestThemePreservesAdditionalProperties(t *testing.T) {
	data := []byte(`{"primaryColor":"#fff","customProperty":"customValue","nested":{"enabled":true}}`)
	var theme Theme
	if err := json.Unmarshal(data, &theme); err != nil {
		t.Fatal(err)
	}
	if theme.PrimaryColor != "#fff" {
		t.Fatalf("PrimaryColor = %q, want #fff", theme.PrimaryColor)
	}
	if got := theme.AdditionalProperties["customProperty"]; got != "customValue" {
		t.Fatalf("customProperty = %#v, want customValue", got)
	}
	if _, ok := theme.AdditionalProperties["nested"].(map[string]any); !ok {
		t.Fatalf("nested = %#v, want object", theme.AdditionalProperties["nested"])
	}
	jsonEquivalent(t, data, theme)
}
