import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    // Lets the app come to the front when triage_ui.sh sends it an item.
    let window = FlutterMethodChannel(
      name: "triage_ui/window",
      binaryMessenger: flutterViewController.engine.binaryMessenger)
    window.setMethodCallHandler { [weak self] call, result in
      guard call.method == "activate" else {
        result(FlutterMethodNotImplemented)
        return
      }
      NSApp.activate(ignoringOtherApps: true)
      self?.makeKeyAndOrderFront(nil)
      result(nil)
    }

    super.awakeFromNib()
  }
}
