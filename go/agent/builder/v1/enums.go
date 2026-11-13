// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package v1

import "github.com/a2ui-project/a2ui/go/agent/builder"

// TextVariant enumerates v1.0 Text semantic variants.
type TextVariant string

const (
	TextVariantCaption TextVariant = "caption"
	TextVariantBody    TextVariant = "body"
)

// EnumValues returns the allowed v1.0 TextVariant literals.
func (TextVariant) EnumValues() []string { return []string{"caption", "body"} }

// ImageFit enumerates Image object-fit modes.
type ImageFit string

const (
	ImageFitContain   ImageFit = "contain"
	ImageFitCover     ImageFit = "cover"
	ImageFitFill      ImageFit = "fill"
	ImageFitNone      ImageFit = "none"
	ImageFitScaleDown ImageFit = "scaleDown"
)

// EnumValues returns the allowed ImageFit literals.
func (ImageFit) EnumValues() []string {
	return []string{"contain", "cover", "fill", "none", "scaleDown"}
}

// ImageVariant enumerates Image presentation variants.
type ImageVariant string

const (
	ImageVariantIcon          ImageVariant = "icon"
	ImageVariantAvatar        ImageVariant = "avatar"
	ImageVariantSmallFeature  ImageVariant = "smallFeature"
	ImageVariantMediumFeature ImageVariant = "mediumFeature"
	ImageVariantLargeFeature  ImageVariant = "largeFeature"
	ImageVariantHeader        ImageVariant = "header"
)

// EnumValues returns the allowed ImageVariant literals.
func (ImageVariant) EnumValues() []string {
	return []string{"icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"}
}

// IconName enumerates standard Basic Catalog icon identifiers.
type IconName string

const (
	IconAccountCircle    IconName = "accountCircle"
	IconAdd              IconName = "add"
	IconArrowBack        IconName = "arrowBack"
	IconArrowForward     IconName = "arrowForward"
	IconAttachFile       IconName = "attachFile"
	IconCalendarToday    IconName = "calendarToday"
	IconCall             IconName = "call"
	IconCamera           IconName = "camera"
	IconCheck            IconName = "check"
	IconClose            IconName = "close"
	IconDelete           IconName = "delete"
	IconDownload         IconName = "download"
	IconEdit             IconName = "edit"
	IconEvent            IconName = "event"
	IconError            IconName = "error"
	IconFastForward      IconName = "fastForward"
	IconFavorite         IconName = "favorite"
	IconFavoriteOff      IconName = "favoriteOff"
	IconFolder           IconName = "folder"
	IconHelp             IconName = "help"
	IconHome             IconName = "home"
	IconInfo             IconName = "info"
	IconLocationOn       IconName = "locationOn"
	IconLock             IconName = "lock"
	IconLockOpen         IconName = "lockOpen"
	IconMail             IconName = "mail"
	IconMenu             IconName = "menu"
	IconMoreVert         IconName = "moreVert"
	IconMoreHoriz        IconName = "moreHoriz"
	IconNotificationsOff IconName = "notificationsOff"
	IconNotifications    IconName = "notifications"
	IconPause            IconName = "pause"
	IconPayment          IconName = "payment"
	IconPerson           IconName = "person"
	IconPhone            IconName = "phone"
	IconPhoto            IconName = "photo"
	IconPlay             IconName = "play"
	IconPrint            IconName = "print"
	IconRefresh          IconName = "refresh"
	IconRewind           IconName = "rewind"
	IconSearch           IconName = "search"
	IconSend             IconName = "send"
	IconSettings         IconName = "settings"
	IconShare            IconName = "share"
	IconShoppingCart     IconName = "shoppingCart"
	IconSkipNext         IconName = "skipNext"
	IconSkipPrevious     IconName = "skipPrevious"
	IconStar             IconName = "star"
	IconStarHalf         IconName = "starHalf"
	IconStarOff          IconName = "starOff"
	IconStop             IconName = "stop"
	IconUpload           IconName = "upload"
	IconVisibility       IconName = "visibility"
	IconVisibilityOff    IconName = "visibilityOff"
	IconVolumeDown       IconName = "volumeDown"
	IconVolumeMute       IconName = "volumeMute"
	IconVolumeOff        IconName = "volumeOff"
	IconVolumeUp         IconName = "volumeUp"
	IconWarning          IconName = "warning"
)

var iconNameValues = []string{
	"accountCircle", "add", "arrowBack", "arrowForward", "attachFile",
	"calendarToday", "call", "camera", "check", "close", "delete", "download",
	"edit", "event", "error", "fastForward", "favorite", "favoriteOff", "folder",
	"help", "home", "info", "locationOn", "lock", "lockOpen", "mail", "menu",
	"moreVert", "moreHoriz", "notificationsOff", "notifications", "pause",
	"payment", "person", "phone", "photo", "play", "print", "refresh", "rewind",
	"search", "send", "settings", "share", "shoppingCart", "skipNext",
	"skipPrevious", "star", "starHalf", "starOff", "stop", "upload", "visibility",
	"visibilityOff", "volumeDown", "volumeMute", "volumeOff", "volumeUp", "warning",
}

// EnumValues returns the allowed IconName literals.
func (IconName) EnumValues() []string { return iconNameValues }

// BuilderVersionFamily returns VersionFamily1_0.
func (IconName) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue validates the icon name enum and returns its string literal.
func (n IconName) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if err := ctx.ValidateEnum("Icon.name", string(n), n); err != nil {
		return nil, err
	}
	return string(n), nil
}

func (IconName) isV1IconNameValue() {}

// FlexJustify enumerates main-axis distribution modes for Row and Column.
type FlexJustify string

const (
	FlexJustifyStart        FlexJustify = "start"
	FlexJustifyCenter       FlexJustify = "center"
	FlexJustifyEnd          FlexJustify = "end"
	FlexJustifySpaceBetween FlexJustify = "spaceBetween"
	FlexJustifySpaceAround  FlexJustify = "spaceAround"
	FlexJustifySpaceEvenly  FlexJustify = "spaceEvenly"
	FlexJustifyStretch      FlexJustify = "stretch"
)

// EnumValues returns the allowed FlexJustify literals.
func (FlexJustify) EnumValues() []string {
	return []string{"start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"}
}

// FlexAlign enumerates cross-axis alignment modes for Row and Column.
type FlexAlign string

const (
	FlexAlignCenter  FlexAlign = "center"
	FlexAlignEnd     FlexAlign = "end"
	FlexAlignStart   FlexAlign = "start"
	FlexAlignStretch FlexAlign = "stretch"
)

// EnumValues returns the allowed FlexAlign literals.
func (FlexAlign) EnumValues() []string {
	return []string{"center", "end", "start", "stretch"}
}

// ListDirection enumerates layout directions for List.
type ListDirection string

const (
	ListDirectionVertical   ListDirection = "vertical"
	ListDirectionHorizontal ListDirection = "horizontal"
)

// EnumValues returns the allowed ListDirection literals.
func (ListDirection) EnumValues() []string { return []string{"vertical", "horizontal"} }

// ListAlign enumerates cross-axis alignment modes for List.
type ListAlign string

const (
	ListAlignStart   ListAlign = "start"
	ListAlignCenter  ListAlign = "center"
	ListAlignEnd     ListAlign = "end"
	ListAlignStretch ListAlign = "stretch"
)

// EnumValues returns the allowed ListAlign literals.
func (ListAlign) EnumValues() []string { return []string{"start", "center", "end", "stretch"} }

// DividerAxis enumerates Divider orientation axes.
type DividerAxis string

const (
	DividerAxisHorizontal DividerAxis = "horizontal"
	DividerAxisVertical   DividerAxis = "vertical"
)

// EnumValues returns the allowed DividerAxis literals.
func (DividerAxis) EnumValues() []string { return []string{"horizontal", "vertical"} }

// ButtonVariant enumerates Button visual variants.
type ButtonVariant string

const (
	ButtonVariantDefault    ButtonVariant = "default"
	ButtonVariantPrimary    ButtonVariant = "primary"
	ButtonVariantBorderless ButtonVariant = "borderless"
)

// EnumValues returns the allowed ButtonVariant literals.
func (ButtonVariant) EnumValues() []string { return []string{"default", "primary", "borderless"} }

// TextFieldVariant enumerates TextField input modes.
type TextFieldVariant string

const (
	TextFieldVariantLongText  TextFieldVariant = "longText"
	TextFieldVariantNumber    TextFieldVariant = "number"
	TextFieldVariantShortText TextFieldVariant = "shortText"
	TextFieldVariantObscured  TextFieldVariant = "obscured"
)

// EnumValues returns the allowed TextFieldVariant literals.
func (TextFieldVariant) EnumValues() []string {
	return []string{"longText", "number", "shortText", "obscured"}
}

// ChoicePickerVariant enumerates ChoicePicker selection cardinality modes.
type ChoicePickerVariant string

const (
	ChoicePickerVariantMultipleSelection ChoicePickerVariant = "multipleSelection"
	ChoicePickerVariantMutuallyExclusive ChoicePickerVariant = "mutuallyExclusive"
)

// EnumValues returns the allowed ChoicePickerVariant literals.
func (ChoicePickerVariant) EnumValues() []string {
	return []string{"multipleSelection", "mutuallyExclusive"}
}

// ChoicePickerDisplayStyle enumerates ChoicePicker visual styles.
type ChoicePickerDisplayStyle string

const (
	ChoicePickerDisplayCheckbox ChoicePickerDisplayStyle = "checkbox"
	ChoicePickerDisplayChips    ChoicePickerDisplayStyle = "chips"
)

// EnumValues returns the allowed ChoicePickerDisplayStyle literals.
func (ChoicePickerDisplayStyle) EnumValues() []string { return []string{"checkbox", "chips"} }
