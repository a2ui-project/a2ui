package v091_test

import (
	"encoding/json"
	"fmt"

	v091 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v091"
)

func Example() {
	msg := v091.ServerMessage{
		Version: v091.Version,
		CreateSurface: &v091.CreateSurface{
			SurfaceID: "demo",
			CatalogID: "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
		},
	}
	data, _ := json.Marshal(msg)
	fmt.Println(string(data))
	// Output: {"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"}}
}

func ExampleComponent() {
	comp := v091.Component{
		ID: "greeting",
		Text: &v091.TextComponent{
			Text:    v091.StringLiteral("Hello, world!"),
			Variant: v091.TextVariantH1,
		},
	}
	data, _ := json.Marshal(comp)
	fmt.Println(string(data))
	// Output: {"component":"Text","id":"greeting","text":"Hello, world!","variant":"h1"}
}

func ExampleDynamicString() {
	// Literal string.
	lit := v091.StringLiteral("hello")
	data, _ := json.Marshal(lit)
	fmt.Println(string(data))

	// Data binding.
	bind := v091.StringBinding("/user/name")
	data, _ = json.Marshal(bind)
	fmt.Println(string(data))
	// Output:
	// "hello"
	// {"path":"/user/name"}
}

func ExampleDynamicNumber() {
	n := v091.NumberLiteral(42)
	data, _ := json.Marshal(n)
	fmt.Println(string(data))
	// Output: 42
}

func ExampleDynamicBoolean() {
	b := v091.BoolBinding("/settings/enabled")
	data, _ := json.Marshal(b)
	fmt.Println(string(data))
	// Output: {"path":"/settings/enabled"}
}
