# A2UI Basic Catalog Implementation Guide

This guide is designed for renderer and client developers implementing the A2UI Basic Catalog (v0.9). It details how to visually present and functionally implement each component and client-side function defined in the catalog.

When building your framework-specific adapters (Layer 3) over the generic A2UI bindings, refer to this document for the expected visual behaviors, suggested layouts, and interaction patterns. This guide uses generic terminology applicable to Web, Mobile (iOS/Android), and Desktop platforms.

---

## 1. Components

### Text

Displays text content.

**Rendering Guidelines:** Text should be rendered using a Markdown parser when possible. If markdown rendering is unavailable or fails, gracefully fallback to rendering the raw text. In such cases, renderers should ideally attempt to strip common Markdown markers (like `**` or `#`) to ensure the text remains legible and aesthetically consistent with the intended presentation.
**Property Mapping:**

- `variant="h1"` through `h5"`: Apply heading styling. Suggested relative font sizes: `h1` (2.5x base), `h2` (2x base), `h3` (1.75x base), `h4` (1.5x base), `h5` (1.25x base).
- `variant="caption"`: Render as smaller text, typically italicized or in a lighter/muted color. Suggested font size: 0.8x base.
- `variant="body"` (default): Standard body text. Uses the base font size (e.g., 16dp/16px).

### Image

Displays an image from a URL.

**Rendering Guidelines:** Ensure the component defaults to a flexible width so it fills its container.
**Property Mapping:**

- `fit`: Map the property to the platform's equivalent content scaling mode (e.g., CSS `object-fit`, iOS `contentMode`, Android `ScaleType`).
- `variant="icon"`: Render very small and square (e.g., 24x24dp).
- `variant="avatar"`: Render small and rounded/circular (e.g., 40x40dp, fully rounded corners).
- `variant="smallFeature"`: Render as a small rectangle (e.g., 100x100dp).
- `variant="mediumFeature"` (default): Render as a medium rectangle (e.g., 100% width up to 300dp, or 200x200dp).
- `variant="largeFeature"`: Render as a large prominent image (e.g., 100% width, max height 400dp).
- `variant="header"`: Render as a full-width banner image, usually at the top of a surface (e.g., 100% width, height 200dp, scaling mode set to cover/crop).

### Icon

Displays a standard system icon.

**Rendering Guidelines:** Map the icon `name` to a system or bundled icon set (e.g., Material Symbols, SF Symbols). The string `name` from the data model (e.g., `accountCircle`) should be converted to the required format (like snake_case `account_circle`) if required by the icon engine. Suggested styling: 24dp size and inherit the current text color.

### Video

A video player.

**Rendering Guidelines:** Render using a native video player component with user controls enabled. Ensure the video container spans the full width of the parent's container for responsiveness. Scrubbing (seeking) should be supported if provided by the native control.

### AudioPlayer

An audio player.

**Rendering Guidelines:** Render using a native audio player component with user controls enabled. Like video, its container should span the full width of its parent. Scrubbing (seeking) should be supported if provided by the native control.

### Row

A horizontal layout container.

**Rendering Guidelines:** Implemented using a horizontal layout container (e.g., CSS Flexbox row, Compose `Row`, SwiftUI `HStack`). Ensure it fills the available width.
**Property Mapping:**

- `justify`: Maps to main-axis alignment (e.g., `justify-content` in CSS, `horizontalArrangement` in Compose). Use equivalents for pushing items to edges (`spaceBetween`) or packing them together (`start`, `center`, `end`).
- `align`: Maps to cross-axis alignment (e.g., `align-items` in CSS, `verticalAlignment` in Compose). Use equivalents for top (`start`), center, or bottom (`end`).

### Column

A vertical layout container.

**Rendering Guidelines:** Implemented using a vertical layout container (e.g., CSS Flexbox column, Compose `Column`, SwiftUI `VStack`).
**Property Mapping:**

- `justify`: Maps to main-axis alignment on the vertical axis.
- `align`: Maps to cross-axis alignment on the horizontal axis.

### List

A scrollable list of components.

**Rendering Guidelines:** Children of a horizontal list should typically have a constrained max-width so they do not stretch indefinitely.
**Property Mapping:**

- `direction="vertical"` (default): Implement as a vertically scrollable view (e.g., CSS `overflow-y: auto`, Compose `LazyColumn`, SwiftUI `ScrollView` vertical).
- `direction="horizontal"`: Implement as a horizontally scrollable view. Hide the scrollbar for a cleaner look if supported by the platform.

### Card

A container with card-like styling that visually groups its child.

**Rendering Guidelines:** Applies a background color distinct from the main surface, rounded corners (e.g., 8dp or 12dp), a subtle shadow or elevation, and inner padding (e.g., 16dp). Note that the card accepts exactly **one** child. If the user wants multiple elements inside a card, they must provide a container (like `Column`) as the single child.

### Tabs

A set of tabs, each with a title and a corresponding child component.

**Rendering Guidelines:** Render a horizontal row of interactive tab headers for the `titles`. Visually indicate the active tab (e.g., bold text, colored bottom border).
**Behavior & State:** Maintain a local `selectedIndex` state (defaulting to 0). When a tab header is tapped, update `selectedIndex` and render _only_ the `child` component that corresponds to that index.

### Divider

A dividing line to separate content.

**Property Mapping:**

- `axis="horizontal"` (default): Render a 1dp tall line spanning 100% width with a subtle border/outline color.
- `axis="vertical"`: Render a 1dp wide line with a set height, spanning the height of the container.

### Modal

A dialog window.

**Rendering Guidelines:**

- **Desktop UIs**: Render as a centered popup or native dialog window over the main content, typically with a dimmed backdrop.
- **Mobile UIs**: Render as a bottom sheet or full-screen dialog over the main content.
- You must provide a mechanism to close the modal (e.g., an "X" button, clicking/tapping the backdrop overlay, or a swipe-to-dismiss gesture).

**Behavior & State:** This component behaves differently than a standard container. It acts as a **Modal Entry Point**. When instantiated, the user only sees the `trigger` child component on the screen (which usually acts and looks like a Button). The modal logic intercepts interactions (taps/clicks) on the `trigger`. When the `trigger` is tapped, the modal opens and displays the `content` child component.

### Button

An interactive button that dispatches a protocol action.

**Rendering Guidelines:** Render as a native interactive button component. It must render its `child` component inside the button (usually a `Text` or `Icon`).
**Behavior & State:** When tapped, it dispatches the `action` back to the server, dynamically resolving the context variables at the moment of the interaction.
**Property Mapping:**

- `variant="default"`: Standard button with a subtle background and border.
- `variant="primary"`: Prominent call-to-action button using the theme's `primaryColor` for its background, and contrasting text.
- `variant="borderless"`: Button with no background or border, appearing like a clickable text link.

### TextField

A field for user text input.

**Rendering Guidelines:** Render using the platform's native text input control.
**Behavior & State:** Establishes **Two-Way Binding**. As the user types, immediately write the new string back to the local data model path bound to `value`.
**Property Mapping:**

- `variant="shortText"` (default): Standard single-line input field.
- `variant="longText"`: Render as a multi-line text area.
- `variant="number"`: Render as a numeric input field, typically showing a numeric keyboard on mobile.
- `variant="obscured"`: Render as an obscured password/secure field.

### CheckBox

A toggleable control with a label.

**Rendering Guidelines:** Render a native checkbox or toggle switch component alongside a text label.
**Behavior & State:** Triggers two-way binding on the `value` path, setting it to boolean `true` or `false` when interacted with.

### ChoicePicker

A component for selecting one or more options from a list.

**Rendering Guidelines:**

- `displayStyle="checkbox"` (default): Render as a dropdown menu, picker wheel, or an expanding vertical list of selectable options. A dropdown wrapper is preferred to save space.
- `displayStyle="chips"`: Render as a horizontal, wrapping row of selectable chips/pills. Selected chips should have a distinct background/border.
- If `filterable` is true, render a text input above the list of options. As the user types, filter the visible options using a case-insensitive substring match on the option labels.

**Behavior & State:** Binds to an array of strings in the data model representing the active selections. Toggle selections in the data model upon user interaction.

### Slider

A control for selecting a numeric value within a range.

**Rendering Guidelines:** Render using the platform's native slider or seek bar component. Optionally display the current numeric value next to the slider track.
**Behavior & State:** Set `min` and `max` limits. Perform two-way binding, updating the numeric `value` path as the user drags the slider. Note that the value is a `number` rather than an integer, allowing for decimal ranges (e.g., 0.0 to 1.0).

### DateTimeInput

An input for date and/or time.

**Rendering Guidelines:** Render using native date and time picker controls.

- If `enableDate` and `enableTime` are both true, show both date and time selection UI.
- If only `enableDate` is true, show only a date picker.
- If only `enableTime` is true, show only a time picker.

**Behavior & State:** The component must convert the platform's native date/time format into a standard ISO 8601 string before writing it to the A2UI data model, and correctly parse ISO 8601 strings coming from the model into the input field.

---

## 2. Client-Side Functions

Functions provide client-side logic for validation, interpolation, and operations. As defined in the Architecture Guide, the reactivity of function arguments is generally handled by the Core Data Layer (specifically the Binder/Context layer).

Core libraries for each language (such as `@a2ui/web_core` for TypeScript) typically provide a complete, framework-agnostic implementation of all the functions in the basic catalog. Developers are encouraged to utilize these shared implementations rather than writing their own.
When a function is called, the system resolves its arguments. If an argument is a static value, it is passed directly. If it is a dynamic binding, the Context layer handles the subscription. For most standard functions, the `execute` implementation simply receives a dictionary of static `args` and returns a static value. The Context layer wraps this execution in a reactive stream (e.g., a `computed` signal) so that the function re-runs whenever any of its dynamic arguments change.

However, complex functions like `formatString` must manually interact with the Context to parse and subscribe to nested dynamic dependencies.

### `formatString`

**Description:** The core interpolation engine. Parses the `args.value` string for `${expression}` blocks, combining literal strings, data paths, and other client-side function results.

**Architecture & Logic:**
Because `formatString` contains dynamic expressions embedded _within_ a string literal, the Context layer cannot pre-resolve them. The implementation must parse the string and manually create a reactive output.

1.  **Parser/Scanner:** Implement a parser that scans the input string (`args.value`) for `${...}` blocks. It must properly handle escaped markers (`\${`) which resolve to a literal `${`.
2.  **Expression Evaluation:** Inside the interpolation block, the parser must differentiate between:
    - **Literals:** Quoted strings (`'...'` or `"..."`), numbers, and keywords (`true`, `false`, `null`).
    - **Data Paths:** Identifiers starting with a slash (`/absolute/path`) or relative identifiers (`relative/path`).
    - **Function Calls:** Identifiers followed by parentheses, e.g., `funcName(argName: value)`.
3.  **Context Resolution:** For every parsed `DataPath` or `FunctionCall` token, use the `DataContext` (e.g., `context.resolveSignal(token)`) to turn it into a reactive stream/signal.
4.  **Reactive Return:** The function MUST return a computed reactive stream (e.g., a `computed(() => ...)` signal). Inside this computed stream, unwrap all the resolved signals, convert them to strings, and concatenate them with the literal string parts.

### `required`

**Description:** Validates that a given value is present.

**Logic:** Return `true` if `args.value` is strictly not `null`, not `undefined`, not an empty string `""`, and not an empty array `[]`. Otherwise, return `false`.

### `regex`

**Description:** Validates a value against a regular expression.

**Logic:** Instantiate a regular expression using `args.pattern`. Test the `args.value` string against it. Return `true` if it matches, `false` otherwise.

### `length`

**Description:** Validates string length constraints.

**Logic:** Ensure the length of the string `args.value` is `>= args.min` (if `min` is provided) and `<= args.max` (if `max` is provided).

### `numeric`

**Description:** Validates numeric range constraints.

**Logic:** Parse `args.value` as a number. Ensure it is `>= args.min` (if `min` is provided) and `<= args.max` (if `max` is provided). Return `true` if valid, `false` if invalid or if it cannot be parsed as a number.

### `email`

**Description:** Validates an email address.

**Logic:** Test `args.value` against a standard email regex pattern (e.g., `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).

### `formatNumber`

**Description:** Formats a numeric value.

**Logic:** Use the platform's native locale formatting (e.g., `Intl.NumberFormat` on the web or `NumberFormatter` natively) on `args.value`.

- If `args.decimals` is provided, force both the minimum and maximum fraction digits to that value.
- Enable grouping (e.g., thousands separators) unless `args.grouping` is explicitly set to `false`.

### `formatCurrency`

**Description:** Formats a number as a currency string.

**Logic:** Similar to `formatNumber`, but configured for currency style formatting. Apply the ISO 4217 currency code provided in `args.currency` (e.g., 'USD', 'EUR').

### `formatDate`

**Description:** Formats a timestamp into a date string.

**Logic:** Parse `args.value` into a native Date/Time object. Interpret the Unicode TR35 `args.format` string (e.g., `yyyy-MM-dd`, `HH:mm`) and construct the formatted date string. You will likely need a platform-specific date formatting library to parse the TR35 pattern.

### `pluralize`

**Description:** Returns a localized pluralized string.

**Logic:** Resolve the plural category for the numeric `args.value` based on the current locale (e.g., using `Intl.PluralRules` on the web). Map the resulting category (`zero`, `one`, `two`, `few`, `many`, `other`) to the corresponding string provided in the `args` object. If the specific category string is missing from `args`, fallback to `args.other`.

### `openUrl`

**Description:** Opens a URL.

**Logic:** Open `args.url` using the native platform's URL handler (e.g., opening in the system browser or deep-linking to an app). This function returns `void` and is executed as a side-effect.

### `and`

**Description:** Logical AND operator.

**Logic:** Iterate through the boolean array `args.values`. Return `true` only if all values are true. Short-circuit evaluation is encouraged.

### `or`

**Description:** Logical OR operator.

**Logic:** Iterate through the boolean array `args.values`. Return `true` if at least one value is true. Short-circuit evaluation is encouraged.

### `not`

**Description:** Logical NOT operator.

**Logic:** Return the strict boolean negation of `args.value`.

---

## 3. Layout Spacing: Margins and Padding

A common challenge in dynamic UI frameworks is preventing "spacing multiplication," where nested containers (e.g., a `Text` inside a `Row` inside a `Column`) result in accumulated empty space that throws off the design.

To achieve a clean, consistent default spacing where elements feel naturally separated without stacking empty space, implementers should follow a **Leaf-Margin Strategy**:

1. **Invisible Containers have ZERO Spacing**: Structural, invisible layout containers (`Row`, `Column`, `List`) should have **no internal padding** and **no external margins**. They act purely as structural boundaries. This guarantees that wrapping an element in a `Row` or `Column` does not alter its spacing.
2. **Leaf Components carry the Margin**: All non-container, visual "leaf" elements (`Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Slider`, etc.) should have a uniform default **external margin** applied to them (e.g., `8dp` on all sides).
3. **Visually Outlined Containers carry the Margin**: Containers and inputs that have a visible boundary (`Card`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`) should also apply this same uniform default **external margin**.
   - _Note:_ These elements will naturally also need internal _padding_ to keep their content away from their own visible borders, but this padding is localized and does not affect the external layout.

**Why use Margins on Leaves?**
Applying margins directly to the visual elements—rather than relying on padding or gap properties on the parent containers—ensures predictable spacing. For example, if you have `Row(Item1, Item2)`, using margins on the items guarantees that there is space to the left of `Item1`, space to the right of `Item2`, and space between them. Because the invisible containers themselves contribute zero extra spacing, you can deeply nest your structural rows and columns without the spacing unexpectedly multiplying.

---

## 4. Color, Contrast, and Nesting

A common challenge in dynamically generated UI is ensuring proper contrast and visual hierarchy when components are nested. For example:

- A `Text` or `Icon` nested inside a `primary` `Button` must change its color to contrast with the button's background.
- A `Card` nested inside another `Card` should remain visually distinct.

To keep the A2UI rendering layer simple and performant, **do not manually calculate or pass color properties down the A2UI component tree**. Instead, rely entirely on the native context and theme inheritance mechanisms provided by your target UI framework.

### Text and Icon Contrast

When an element defines a strong background color (like a `primary` `Button` using the theme's `primaryColor`), it must also define the expected text color for its content. It should propagate this expectation implicitly.

- **Web (CSS):** The `Button` wrapper sets the standard CSS `color` property. Because `color` is inherited in CSS, any `Text` or `Icon` component rendered inside the button will automatically adapt.
- **Compose (Android):** The button wrapper should use `CompositionLocalProvider(LocalContentColor provides ...)`. Any nested `Text` and `Icon` components will automatically pick up this color without needing it explicitly passed to their A2UI classes.
- **SwiftUI (iOS):** Apply `.foregroundColor(...)` or `.environment(\.colorScheme, ...)` to the button wrapper.
- **Flutter:** Use `DefaultTextStyle.merge()` and `IconTheme.merge()` within the button wrapper. If using standard Material buttons (like `ElevatedButton`), this is often handled for you automatically.

_Rule of Thumb:_ Leaf components like `Text` and `Icon` should **never** hardcode their colors unless explicitly instructed by a property. They must always inherit from their environment.

### Nesting Containers (Cards)

When a `Card` is nested within another `Card`, or placed on different background surfaces, it needs to remain distinct. Attempting to alternate surface colors based on depth adds significant complexity to the renderer.

**Recommended Approach: Outlines and Transparent Surfaces**
The simplest, most robust starting approach is to give `Card` components a **transparent background** and a **visible outline/border** (e.g., a 1dp outline matching the theme's outline/border color).

- By using borders instead of opaque surface colors, nested cards will simply draw an inner boundary within the parent card.
- This guarantees a clear visual hierarchy regardless of how deeply they are nested, and it requires zero context-passing or depth-tracking in your code.
- If your design system requires opaque cards, consider using a framework-specific elevation system (e.g., standard Material elevation) which often handles shadow and surface tinting automatically, rather than building custom color-alternation logic into the A2UI adapters.
