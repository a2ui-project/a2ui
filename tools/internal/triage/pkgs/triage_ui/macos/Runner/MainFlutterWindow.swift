import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow, NSWindowDelegate {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    // Closing the window quits the app, so that the app can offer the
    // session report first. See AppLifecycleListener.onExitRequested.
    self.delegate = self

    super.awakeFromNib()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    NSApp.terminate(sender)
    return false
  }
}
