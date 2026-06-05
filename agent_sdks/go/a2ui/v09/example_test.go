package v09_test

import (
	"encoding/json"
	"fmt"

	v09 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v09"
)

func Example() {
	msg := v09.ServerMessage{
		Version: v09.Version,
		CreateSurface: &v09.CreateSurface{
			SurfaceID: "demo",
			CatalogID: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
		},
	}
	data, _ := json.Marshal(msg)
	fmt.Println(string(data))
	// Output: {"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
}

func ExampleComponent() {
	comp := v09.Component{
		ID: "greeting",
		Text: &v09.TextComponent{
			Text:    v09.StringLiteral("Hello, world!"),
			Variant: v09.TextVariantH1,
		},
	}
	data, _ := json.Marshal(comp)
	fmt.Println(string(data))
	// Output: {"component":"Text","id":"greeting","text":"Hello, world!","variant":"h1"}
}

func ExampleDynamicString() {
	// Literal string.
	lit := v09.StringLiteral("hello")
	data, _ := json.Marshal(lit)
	fmt.Println(string(data))

	// Data binding.
	bind := v09.StringBinding("/user/name")
	data, _ = json.Marshal(bind)
	fmt.Println(string(data))
	// Output:
	// "hello"
	// {"path":"/user/name"}
}

func ExampleDynamicNumber() {
	n := v09.NumberLiteral(42)
	data, _ := json.Marshal(n)
	fmt.Println(string(data))
	// Output: 42
}

func ExampleDynamicBoolean() {
	b := v09.BoolBinding("/settings/enabled")
	data, _ := json.Marshal(b)
	fmt.Println(string(data))
	// Output: {"path":"/settings/enabled"}
}
