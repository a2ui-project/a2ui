package a2uibuild

import "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"

// Children returns a static child list containing ids.
func Children(ids ...string) a2ui.ChildList {
	return a2ui.ChildList{IDs: append([]string(nil), ids...)}
}
