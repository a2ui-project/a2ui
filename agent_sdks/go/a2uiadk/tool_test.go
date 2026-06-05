package a2uiadk

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uischema"
)

func TestSendA2UIJSONToClientToolRun(t *testing.T) {
	catalog := testCatalog(t)
	tool := NewSendA2UIJSONToClientTool(catalog.Validator())
	ctx := &ToolContext{}
	result := tool.Run(map[string]any{
		A2UIJSONArgName: `[
			{"version":"v0.9","createSurface":{"surfaceId":"dummy-surface","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}},
			{"version":"v0.9","updateComponents":{"surfaceId":"dummy-surface","components":[{"component":"Text","id":"root","text":"hello"}]}}
		]`,
	}, ctx)
	if _, ok := result[ToolErrorKey]; ok {
		t.Fatalf("Run returned error: %#v", result)
	}
	if !ctx.SkipSummarization {
		t.Fatal("SkipSummarization = false, want true")
	}
	payload, ok := result[ValidatedJSONKey].([]map[string]any)
	if !ok {
		t.Fatalf("validated payload type = %T", result[ValidatedJSONKey])
	}
	if len(payload) != 2 {
		t.Fatalf("validated payload length = %d, want 2", len(payload))
	}
}

func TestSendA2UIJSONToClientToolRunMissingArg(t *testing.T) {
	tool := NewSendA2UIJSONToClientTool(testCatalog(t).Validator())
	result := tool.Run(map[string]any{"wrong_arg": "b"}, nil)
	errText, ok := result[ToolErrorKey].(string)
	if !ok {
		t.Fatalf("missing error in result %#v", result)
	}
	if !strings.Contains(errText, "missing required arg a2ui_json") {
		t.Fatalf("error = %q", errText)
	}
}

func TestSendA2UIJSONToClientToolDeclaration(t *testing.T) {
	decl := NewSendA2UIJSONToClientTool(nil).Declaration()
	if decl.Name != ToolName {
		t.Fatalf("Name = %q, want %q", decl.Name, ToolName)
	}
	if len(decl.Required) != 1 || decl.Required[0] != A2UIJSONArgName {
		t.Fatalf("Required = %#v", decl.Required)
	}
	data, err := json.Marshal(decl.Parameters)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), A2UIJSONArgName) {
		t.Fatalf("parameters missing %q: %s", A2UIJSONArgName, data)
	}
}

func TestProcessInstructions(t *testing.T) {
	instructions, err := ProcessInstructions(testCatalog(t), "examples")
	if err != nil {
		t.Fatal(err)
	}
	if len(instructions) != 2 {
		t.Fatalf("instructions length = %d, want 2", len(instructions))
	}
	if !strings.Contains(instructions[0], a2uischema.A2UISchemaBlockStart) {
		t.Fatalf("missing schema block: %q", instructions[0])
	}
}

func testCatalog(t *testing.T) *a2uischema.Catalog {
	t.Helper()
	cfg, err := a2uischema.BasicCatalogConfig(a2uischema.Version09)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := a2uischema.NewSchemaManager(a2uischema.Version09, []a2uischema.CatalogConfig{cfg}, false)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := manager.SelectedCatalog(nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}
