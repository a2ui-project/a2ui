package a2uibuild_test

import (
	"encoding/json"
	"fmt"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uibuild"
)

func Example() {
	s := a2uibuild.NewSurface("contact", "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json").
		Add(a2uibuild.Column("root", a2uibuild.Children("greeting"))).
		Add(a2uibuild.Text("greeting", a2ui.StringLiteral("Hello, world!")))

	for _, msg := range s.Messages() {
		data, _ := json.Marshal(msg)
		fmt.Println(string(data))
	}
	// Output:
	// {"version":"v0.9","createSurface":{"surfaceId":"contact","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
	// {"version":"v0.9","updateComponents":{"surfaceId":"contact","components":[{"component":"Column","id":"root","children":["greeting"]},{"component":"Text","id":"greeting","text":"Hello, world!"}]}}
}
