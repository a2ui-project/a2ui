package a2a_test

import (
	"fmt"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2a"
)

func ExampleCreateDataPart() {
	part, err := a2a.CreateDataPart(map[string]any{
		"version": "v0.10",
		"updateDataModel": map[string]any{
			"surfaceId": "dashboard",
			"value":     map[string]any{"status": "ready"},
		},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(part.Metadata[a2a.MIMETypeKey])
	fmt.Println(a2a.IsPart(part))
	// Output:
	// application/a2ui+json
	// true
}

func ExampleTryActivateExtension() {
	activated, version, ok := a2a.TryActivateExtension(
		[]string{"https://a2ui.org/a2a-extension/a2ui/v0.9"},
		[]string{"https://a2ui.org/a2a-extension/a2ui/v0.9"},
	)
	fmt.Println(activated)
	fmt.Println(version)
	fmt.Println(ok)
	// Output:
	// https://a2ui.org/a2a-extension/a2ui/v0.9
	// 0.9
	// true
}
