package a2ui_test

import (
	"encoding/json"
	"fmt"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
)

func Example() {
	msg := a2ui.ServerMessage{
		Version: a2ui.Version,
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID: "demo",
			CatalogID: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
		},
	}
	data, _ := json.Marshal(msg)
	fmt.Println(string(data))
	// Output: {"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
}

func ExampleComponent() {
	comp := a2ui.Component{
		ID: "greeting",
		Text: &a2ui.TextComponent{
			Text:    a2ui.StringLiteral("Hello, world!"),
			Variant: a2ui.TextVariantH1,
		},
	}
	data, _ := json.Marshal(comp)
	fmt.Println(string(data))
	// Output: {"component":"Text","id":"greeting","text":"Hello, world!","variant":"h1"}
}
