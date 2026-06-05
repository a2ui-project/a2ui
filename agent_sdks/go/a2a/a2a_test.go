package a2a

import "testing"

func TestCreatePart(t *testing.T) {
	part, err := CreateDataPart(map[string]any{"version": "v0.9"})
	if err != nil {
		t.Fatal(err)
	}
	if !IsPart(part) {
		t.Fatal("expected A2UI part")
	}
	if _, ok := Data(part); !ok {
		t.Fatal("expected A2UI data")
	}
	if got := part.Metadata[MIMETypeKey]; got != A2UIMIMETypeV09 {
		t.Fatalf("mime type = %q, want %q", got, A2UIMIMETypeV09)
	}
}

func TestCreatePartUsesVersionedMIMEType(t *testing.T) {
	tests := []struct {
		name    string
		version string
		want    string
	}{
		{"v0.9", "v0.9", A2UIMIMETypeV09},
		{"v0.9.1", "v0.9.1", A2UIMIMETypeV091},
		{"v0.10", "v0.10", A2UIMIMETypeV010},
		{"default", "", A2UIMIMETypeLatest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			part, err := CreateDataPartForVersion(map[string]any{"version": tt.version}, tt.version)
			if err != nil {
				t.Fatal(err)
			}
			if got := part.Metadata[MIMETypeKey]; got != tt.want {
				t.Fatalf("mime type = %q, want %q", got, tt.want)
			}
			if !IsPart(part) {
				t.Fatal("expected A2UI part")
			}
		})
	}
}

func TestCreateDataPartInfersVersionedPayload(t *testing.T) {
	part, err := CreateDataPart(versionedPayload{Version: "v0.10", Kind: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	if got := part.Metadata[MIMETypeKey]; got != A2UIMIMETypeV010 {
		t.Fatalf("mime type = %q, want %q", got, A2UIMIMETypeV010)
	}
}

func TestMarshalA2UIDataClonesMapPayload(t *testing.T) {
	payload := map[string]any{"version": "v0.10"}
	data, err := MarshalA2UIData(payload)
	if err != nil {
		t.Fatal(err)
	}
	data["version"] = "changed"
	if got := payload["version"]; got != "v0.10" {
		t.Fatalf("payload version = %q, want unchanged", got)
	}
}

func TestCreateDataPartRejectsNonObject(t *testing.T) {
	if _, err := CreateDataPart([]string{"not", "an", "object"}); err == nil {
		t.Fatal("expected error")
	}
}

func TestNewAgentExtension(t *testing.T) {
	ext := NewAgentExtension(AgentExtensionOptions{
		Version:               "0.9",
		AcceptsInlineCatalogs: true,
		SupportedCatalogIDs:   []string{"catalog"},
	})
	if ext.URI != "https://a2ui.org/a2a-extension/a2ui/v0.9" {
		t.Fatalf("uri = %q", ext.URI)
	}
	if ext.Params[AcceptsInlineCatalogsKey] != true {
		t.Fatal("expected acceptsInlineCatalogs param")
	}
}

func TestSelectNewestRequestedExtension(t *testing.T) {
	got, ok := SelectNewestRequestedExtension(
		[]string{
			"https://a2ui.org/a2a-extension/a2ui/v0.8",
			"https://a2ui.org/a2a-extension/a2ui/v0.9",
		},
		[]string{
			"https://a2ui.org/a2a-extension/a2ui/v0.8",
			"https://a2ui.org/a2a-extension/a2ui/v0.9",
		},
	)
	if !ok {
		t.Fatal("expected a match")
	}
	if want := "https://a2ui.org/a2a-extension/a2ui/v0.9"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

type versionedPayload struct {
	Version string `json:"version"`
	Kind    string `json:"kind"`
}

func (p versionedPayload) VersionString() string {
	return p.Version
}
