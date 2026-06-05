package a2uiadk_test

import (
	"fmt"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uiadk"
	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uischema"
)

func ExampleSendA2UIJSONToClientTool_Run() {
	cfg, _ := a2uischema.BasicCatalogConfig(a2uischema.Version09)
	manager, _ := a2uischema.NewSchemaManager(a2uischema.Version09, []a2uischema.CatalogConfig{cfg}, false)
	catalog, _ := manager.SelectedCatalog(nil, nil, nil)
	tool := a2uiadk.NewSendA2UIJSONToClientTool(catalog.Validator())

	result := tool.Run(map[string]any{
		a2uiadk.A2UIJSONArgName: `[
			{"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}},
			{"version":"v0.9","updateComponents":{"surfaceId":"demo","components":[{"component":"Text","id":"root","text":"hello"}]}}
		]`,
	}, nil)
	_, ok := result[a2uiadk.ValidatedJSONKey]
	fmt.Println(ok)
	// Output: true
}
