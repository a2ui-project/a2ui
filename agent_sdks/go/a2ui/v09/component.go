package v09

// Component represents any A2UI component in the component tree.
// Exactly one of the concrete type fields is non-nil.
//
// MarshalJSON/UnmarshalJSON in zz_component_marshal.go handle
// serialization, using the "component" field as a discriminator.
type Component struct {
	ID            string                   `json:"id"`
	Accessibility *AccessibilityAttributes `json:"accessibility,omitempty"`
	Weight        *float64                 `json:"weight,omitempty"`
	Checks        []CheckRule              `json:"checks,omitempty"`

	// Concrete type fields (exactly one non-nil).
	Text          *TextComponent          `json:"-"`
	Image         *ImageComponent         `json:"-"`
	Icon          *IconComponent          `json:"-"`
	Video         *VideoComponent         `json:"-"`
	AudioPlayer   *AudioPlayerComponent   `json:"-"`
	Row           *RowComponent           `json:"-"`
	Column        *ColumnComponent        `json:"-"`
	List          *ListComponent          `json:"-"`
	Card          *CardComponent          `json:"-"`
	Tabs          *TabsComponent          `json:"-"`
	Modal         *ModalComponent         `json:"-"`
	Divider       *DividerComponent       `json:"-"`
	Button        *ButtonComponent        `json:"-"`
	TextField     *TextFieldComponent     `json:"-"`
	CheckBox      *CheckBoxComponent      `json:"-"`
	ChoicePicker  *ChoicePickerComponent  `json:"-"`
	Slider        *SliderComponent        `json:"-"`
	DateTimeInput *DateTimeInputComponent `json:"-"`
}

func (c Component) componentData() (string, any, int) {
	var (
		componentType string
		specific      any
		count         int
	)
	set := func(typ string, value any) {
		componentType = typ
		specific = value
		count++
	}
	if c.Text != nil {
		set("Text", c.Text)
	}
	if c.Image != nil {
		set("Image", c.Image)
	}
	if c.Icon != nil {
		set("Icon", c.Icon)
	}
	if c.Video != nil {
		set("Video", c.Video)
	}
	if c.AudioPlayer != nil {
		set("AudioPlayer", c.AudioPlayer)
	}
	if c.Row != nil {
		set("Row", c.Row)
	}
	if c.Column != nil {
		set("Column", c.Column)
	}
	if c.List != nil {
		set("List", c.List)
	}
	if c.Card != nil {
		set("Card", c.Card)
	}
	if c.Tabs != nil {
		set("Tabs", c.Tabs)
	}
	if c.Modal != nil {
		set("Modal", c.Modal)
	}
	if c.Divider != nil {
		set("Divider", c.Divider)
	}
	if c.Button != nil {
		set("Button", c.Button)
	}
	if c.TextField != nil {
		set("TextField", c.TextField)
	}
	if c.CheckBox != nil {
		set("CheckBox", c.CheckBox)
	}
	if c.ChoicePicker != nil {
		set("ChoicePicker", c.ChoicePicker)
	}
	if c.Slider != nil {
		set("Slider", c.Slider)
	}
	if c.DateTimeInput != nil {
		set("DateTimeInput", c.DateTimeInput)
	}
	return componentType, specific, count
}

// ComponentType returns the discriminator string (e.g. "Text", "Button").
func (c Component) ComponentType() string {
	componentType, _, count := c.componentData()
	if count != 1 {
		return ""
	}
	return componentType
}
