package a2uibuild

import (
	"maps"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
)

// Surface builds a complete A2UI surface as a sequence of server messages.
type Surface struct {
	surfaceID  string
	catalogID  string
	theme      *a2ui.Theme
	components []a2ui.Component
	data       map[string]any
	sendData   bool
}

// NewSurface returns a surface builder with the given surface and catalog IDs.
func NewSurface(surfaceID, catalogID string) Surface {
	return Surface{
		surfaceID: surfaceID,
		catalogID: catalogID,
	}
}

// WithTheme returns a surface with theme parameters set.
func (s Surface) WithTheme(t a2ui.Theme) Surface {
	s.theme = &t
	return s
}

// WithSendDataModel returns a surface that requests client data in actions.
func (s Surface) WithSendDataModel() Surface {
	s.sendData = true
	return s
}

// Add returns a surface with c appended.
func (s Surface) Add(c a2ui.Component) Surface {
	s.components = append(slicesClone(s.components), c)
	return s
}

// WithData returns a surface with the initial data model set.
func (s Surface) WithData(data map[string]any) Surface {
	s.data = maps.Clone(data)
	return s
}

// Messages returns the server messages needed to render this surface.
func (s Surface) Messages() []a2ui.ServerMessage {
	var msgs []a2ui.ServerMessage

	msgs = append(msgs, a2ui.ServerMessage{
		Version: a2ui.Version,
		CreateSurface: &a2ui.CreateSurface{
			SurfaceID:     s.surfaceID,
			CatalogID:     s.catalogID,
			Theme:         s.theme,
			SendDataModel: s.sendData,
		},
	})

	if len(s.components) > 0 {
		msgs = append(msgs, a2ui.ServerMessage{
			Version: a2ui.Version,
			UpdateComponents: &a2ui.UpdateComponents{
				SurfaceID:  s.surfaceID,
				Components: slicesClone(s.components),
			},
		})
	}

	if len(s.data) > 0 {
		msgs = append(msgs, a2ui.ServerMessage{
			Version: a2ui.Version,
			UpdateDataModel: &a2ui.UpdateDataModel{
				SurfaceID: s.surfaceID,
				Value:     maps.Clone(s.data),
			},
		})
	}

	return msgs
}

func slicesClone[S ~[]E, E any](s S) S {
	if s == nil {
		return nil
	}
	return append(S(nil), s...)
}
