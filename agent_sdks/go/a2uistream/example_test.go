package a2uistream_test

import (
	"fmt"
	"io"
	"strings"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uistream"
)

func ExampleReader_Next() {
	input := `Before <a2ui-json>{"version":"v0.9","deleteSurface":{"surfaceId":"old"}}</a2ui-json> after`
	r := a2uistream.NewReader(strings.NewReader(input))
	for {
		part, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			panic(err)
		}
		if part.Text != "" {
			fmt.Println(strings.TrimSpace(part.Text))
		}
		for _, msg := range part.Messages {
			fmt.Println(msg.DeleteSurface.SurfaceID)
		}
	}
	// Output:
	// Before
	// old
	// after
}

func ExampleReader_Next_payload() {
	input := `Before <a2ui-json>{"version":"v0.10","functionCallId":"call-1","callFunction":{"call":"lookup","returnType":"string"}}</a2ui-json>`
	r := a2uistream.NewReader(strings.NewReader(input))
	for {
		part, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			panic(err)
		}
		for _, payload := range part.Payload {
			fmt.Println(payload["version"])
			fmt.Println(payload["functionCallId"])
		}
	}
	// Output:
	// v0.10
	// call-1
}

func ExampleFixPayload() {
	payload, err := a2uistream.FixPayload(`{"type": “Text”, "text": "Hello",}`)
	if err != nil {
		panic(err)
	}
	fmt.Println(payload[0]["type"])
	fmt.Println(payload[0]["text"])
	// Output:
	// Text
	// Hello
}

func ExampleParseResponse() {
	parts, err := a2uistream.ParseResponse(`Intro
<a2ui-json>[{"id":"card"}]</a2ui-json>
Done`)
	if err != nil {
		panic(err)
	}
	fmt.Println(parts[0].Text)
	fmt.Println(parts[0].Payload[0]["id"])
	fmt.Println(parts[1].Text)
	// Output:
	// Intro
	// card
	// Done
}
