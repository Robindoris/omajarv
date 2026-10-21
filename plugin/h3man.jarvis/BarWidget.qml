import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// JARVIS bar widget: a small arc reactor that reports bridge health and opens
// the panel with the phone QR code. The heavy lifting lives in the `jarvis`
// CLI, so this widget only shells out and renders what it returns.
BarWidget {
  id: root
  moduleName: "h3man.jarvis"

  property var panelItem: null
  property bool online: false
  property string agentLabel: ""
  property bool animate: setting("animate", true)
  property int pollSeconds: setting("pollSeconds", 20)

  readonly property string jarvisBin: {
    var home = Quickshell.env("HOME") || ""
    return home ? home + "/.local/bin/jarvis" : "jarvis"
  }
  readonly property color tint: online ? Color.accent : (bar ? bar.foreground : Color.foreground)

  readonly property bool opened: panelItem ? panelItem.opened === true : false
  readonly property bool popoutSwitchClosing: panelItem ? panelItem.popoutSwitchClosing === true : false

  function open() { if (panelItem) { panelItem.tab = 0; panelItem.open() } }
  function phone() { if (panelItem) { panelItem.tab = 1; panelItem.open() } }
  function close() { if (panelItem) panelItem.close() }
  function togglePanel() { if (panelItem) panelItem.toggle() }
  function closeForPopoutSwitch() { if (panelItem) panelItem.closeForPopoutSwitch() }
  function refreshStatus() { if (!statusProc.running) statusProc.running = true }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  Component.onCompleted: refreshStatus()

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    panelItem = target
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  Process {
    id: statusProc
    command: [root.jarvisBin, "status", "--json"]
    running: false
    stdout: StdioCollector {
      id: statusOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.online = false
        return
      }
      try {
        var payload = JSON.parse(statusOut.text || "{}")
        root.online = payload.running === true
        root.agentLabel = payload.agent && payload.agent.label ? String(payload.agent.label) : ""
        if (root.panelItem && typeof root.panelItem.applyStatus === "function")
          root.panelItem.applyStatus(payload)
      } catch (e) {
        root.online = false
      }
    }
  }

  Timer {
    interval: Math.max(5, root.pollSeconds) * 1000
    running: root.animate
    repeat: true
    onTriggered: root.refreshStatus()
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "h3man.jarvis"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function refresh(): void { root.refreshStatus() }
    function phone(): void { root.phone() }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    tooltipText: {
      var state = root.online ? "online" : "offline"
      return "JARVIS " + state + (root.agentLabel ? " · " + root.agentLabel : "") + " · click for phone link"
    }
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.LeftButton) root.togglePanel()
      else if (mouseButton === Qt.RightButton) root.refreshStatus()
    }

    iconComponent: Component {
      Canvas {
        id: reactor
        anchors.fill: parent
        antialiasing: true
        opacity: root.online ? 1.0 : 0.55
        property real phase: 0
        // Mirrored onto the canvas so its own change signal can repaint; the
        // canvas cannot observe BarWidget's `tint` through an onTintChanged
        // handler, that name belongs to the canvas itself.
        property color strokeColor: root.tint

        Component.onCompleted: requestPaint()
        onPhaseChanged: requestPaint()
        onWidthChanged: requestPaint()
        onStrokeColorChanged: requestPaint()

        Timer {
          interval: 50
          running: root.animate
          repeat: true
          onTriggered: reactor.phase += 0.09
        }

        onPaint: {
          var ctx = getContext("2d")
          ctx.reset()
          var cx = width / 2
          var cy = height / 2
          var radius = Math.min(width, height) / 2 - 0.5
          var phase = reactor.phase

          ctx.strokeStyle = reactor.strokeColor
          ctx.lineCap = "round"

          // Outer ring: two long arcs spinning one way.
          ctx.lineWidth = Math.max(1, radius * 0.13)
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.arc(cx, cy, radius, phase, phase + 1.9)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(cx, cy, radius, phase + Math.PI, phase + Math.PI + 1.9)
          ctx.stroke()

          // Inner ring: counter-rotating, thinner.
          ctx.globalAlpha = 0.55
          ctx.lineWidth = Math.max(1, radius * 0.09)
          ctx.beginPath()
          ctx.arc(cx, cy, radius * 0.62, -phase * 1.5, -phase * 1.5 + 2.5)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(cx, cy, radius * 0.62, -phase * 1.5 + Math.PI, -phase * 1.5 + Math.PI + 2.5)
          ctx.stroke()

          // Core: a breathing dot, brighter when the bridge is up.
          var pulse = 0.6 + 0.4 * Math.sin(phase * 1.8)
          ctx.globalAlpha = root.online ? 0.95 : 0.5
          ctx.fillStyle = reactor.strokeColor
          ctx.beginPath()
          ctx.arc(cx, cy, Math.max(1, radius * 0.22 * pulse + radius * 0.1), 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }
  }
}
