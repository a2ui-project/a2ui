package v010_test

import (
	"encoding/json"
	"fmt"

	v010 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v010"
)

func Example() {
	msg := v010.ServerMessage{
		Version: v010.Version,
		CreateSurface: &v010.CreateSurface{
			SurfaceID: "demo",
			CatalogID: "https://a2ui.org/specification/v0_10/catalogs/basic/catalog.json",
		},
	}
	data, _ := json.Marshal(msg)
	fmt.Println(string(data))
	// Output: {"version":"v0.10","createSurface":{"surfaceId":"demo","catalogId":"https://a2ui.org/specification/v0_10/catalogs/basic/catalog.json"}}
}

func ExampleComponent() {
	comp := v010.Component{
		ID: "greeting",
		Text: &v010.TextComponent{
			Text:    v010.StringLiteral("Hello, world!"),
			Variant: v010.TextVariantH1,
		},
	}
	data, _ := json.Marshal(comp)
	fmt.Println(string(data))
	// Output: {"component":"Text","id":"greeting","text":"Hello, world!","variant":"h1"}
}

func ExampleDynamicString() {
	// Literal string.
	lit := v010.StringLiteral("hello")
	data, _ := json.Marshal(lit)
	fmt.Println(string(data))

	// Data binding.
	bind := v010.StringBinding("/user/name")
	data, _ = json.Marshal(bind)
	fmt.Println(string(data))
	// Output:
	// "hello"
	// {"path":"/user/name"}
}

func ExampleDynamicNumber() {
	n := v010.NumberLiteral(42)
	data, _ := json.Marshal(n)
	fmt.Println(string(data))
	// Output: 42
}

func ExampleDynamicBoolean() {
	b := v010.BoolBinding("/settings/enabled")
	data, _ := json.Marshal(b)
	fmt.Println(string(data))
	// Output: {"path":"/settings/enabled"}
}
