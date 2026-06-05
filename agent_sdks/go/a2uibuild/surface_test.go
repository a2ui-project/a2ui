package a2uibuild

import (
	"encoding/json"
	"testing"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
)

func TestSurfaceMessagesMarshal(t *testing.T) {
	s := NewSurface("contact", "catalog").
		Add(Column("root", Children("greeting"))).
		Add(Text("greeting", a2ui.StringLiteral("Hello, world!")))

	for i, msg := range s.Messages() {
		if _, err := json.Marshal(msg); err != nil {
			t.Fatalf("message[%d]: marshal: %v", i, err)
		}
	}
}

func TestChildrenClonesIDs(t *testing.T) {
	ids := []string{"a", "b"}
	children := Children(ids...)
	ids[0] = "changed"
	if children.IDs[0] != "a" {
		t.Fatalf("Children aliases input slice")
	}
}

func TestSurfaceBuilderDoesNotMutateBase(t *testing.T) {
	base := NewSurface("contact", "catalog")
	left := base.Add(Text("left", a2ui.StringLiteral("left")))
	right := base.Add(Text("right", a2ui.StringLiteral("right")))

	if got := len(base.Messages()); got != 1 {
		t.Fatalf("base messages = %d, want 1", got)
	}
	if got := componentID(t, left); got != "left" {
		t.Fatalf("left component = %q, want left", got)
	}
	if got := componentID(t, right); got != "right" {
		t.Fatalf("right component = %q, want right", got)
	}
}

func componentID(t *testing.T, s Surface) string {
	t.Helper()
	msgs := s.Messages()
	if len(msgs) != 2 {
		t.Fatalf("messages = %d, want 2", len(msgs))
	}
	components := msgs[1].UpdateComponents.Components
	if len(components) != 1 || components[0].Text == nil {
		t.Fatalf("unexpected components: %+v", components)
	}
	return components[0].ID
}
