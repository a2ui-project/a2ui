# A2UI Swift Sample Client (Gallery App)

An interactive, iPhone-optimized **Gallery Application** built with SwiftUI for testing A2UI streaming messages, evaluating state models, and observing progressive rendering lifecycles.

---

## 1. Features & UX Architecture

Adhering to the A2UI Spec-Driven Development framework adapter blueprint (`a2ui_framework_adapter.blueprint.md`), the Gallery app adapts its UI across iOS device form factors:

- **Sample Navigation**: A sidebar table displaying canonical A2UI stream examples and test cases loaded directly from the core specification.
- **Surface Preview & Stepper Toolbar**: Located on the center canvas (or upper viewport on iPhone), allowing developers to step through message evaluation step-by-step (**Advance**), play through the entire stream (**Play All**), or clear state and restart (**Reset**).
- **Segmented Inspector Pane**: On iPhone (compact width), a bottom tabbed drawer toggles between:
  1. **Messages**: The chronological JSON message stream, highlighting processed steps versus pending evaluation steps.
  2. **Live Data Model**: Real-time formatted string output of the active surface `DataModel`.
  3. **Logs & Errors**: Captured client action dispatches and catalog schema fallback notifications.

---

## 2. Zero-Duplication Resource Streaming

To preserve Git repository efficiency, this application **does not duplicate** sample JSON files in source control. Instead, `A2UISampleClient.xcodeproj` uses native **Xcode Folder References** to point directly to authoritative repository specifications at build time:

- `specification/v0_9_1/catalogs/basic/examples/` (.json streams)
- `specification/v0_9_1/test/cases/` (.jsonl test streams)

At runtime, `SampleLoader` automatically traverses the app bundle to present all available examples in the gallery UI.

---

## 3. Building & Running

The sample app is built exclusively as an iOS Application via Xcode (`A2UISampleClient.xcodeproj`), linking local package dependencies (`A2UISwiftCore` and `A2UISwiftUI`) directly from the monorepo root `Package.swift`.

### Option A: Using Xcode (Recommended)

1. Open the Xcode project manifest:
   ```bash
   open swift/sample/A2UISampleClient.xcodeproj
   ```
2. In the Xcode scheme picker, select **A2UISampleClient** and choose an iOS Simulator destination (e.g., _iPhone 16 Pro, iOS 18_).
3. Press **⌘R** (or navigate to **Product > Run**) to build and launch the application in Simulator.

### Option B: Using Command Line (`xcodebuild` + `simctl`)

1. From the monorepo root directory, compile the project targeting the iOS Simulator:
   ```bash
   xcodebuild -project swift/sample/A2UISampleClient.xcodeproj \
              -scheme A2UISampleClient \
              -sdk iphonesimulator \
              -destination "generic/platform=iOS Simulator" \
              build
   ```
2. Open the macOS Simulator and deploy the freshly built application wrapper:
   ```bash
   open -a Simulator
   APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "A2UISampleClient.app" -type d -path "*Debug-iphonesimulator*" | head -n 1)
   xcrun simctl install booted "$APP_PATH"
   xcrun simctl launch booted org.a2ui.A2UISampleClient
   ```

---

## 4. Basic Catalog Development Status

The A2UI SwiftUI rendering layer is actively under development. Currently, `A2UISampleClient` implements the full `BasicCatalogSwiftUI` integration, providing functional SwiftUI implementations for the standard Basic Catalog components.

> [!NOTE]
> You can step through component updates in the Gallery to see them render progressively on the surface canvas.
