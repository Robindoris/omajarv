pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as OmarchyCommons
import qs.Ui as Ui

Ui.Panel {
  id: root
  moduleName: "h3man.jarvis"
  ipcTarget: "h3man.jarvis"
  manageIpc: false
  property var anchorItem: null
  property var hostWidget: null
  property var status: ({})
  property bool statusLoaded: false
  property var setup: ({})
  property bool setupLoaded: false
  property int tab: 0
  property bool qrTailscale: false
  property bool qrLan: false
  property string qrImage: ""
  property int matrixSize: 0
  property string qrForUrl: ""
  property string qrRequestUrl: ""
  property bool qrRequestLan: false
  property string qrError: ""
  property bool qrTimedOut: false
  property bool busy: false
  property string notice: ""
  property string assistantState: "Ready"
  property string lastOutcome: ""
  property double activityStarted: 0
  property int activitySeconds: 0
  readonly property bool activityActive: running && (working || remoteBusy)
  readonly property bool waitingForReply: assistantState === "Sending" || assistantState === "Thinking" || assistantState === "Stopping"
  readonly property string activityTitle: !statusLoaded ? "Connecting to JARVIS" : !running ? "Bridge offline"
    : working ? (assistantState === "Thinking" ? "Waiting for " + (agent.label || "your agent") : assistantState === "Responding" ? "Receiving reply" : assistantState === "Preparing voice" ? "Preparing voice" : assistantState)
    : remoteBusy ? "Agent active on another device" : lastOutcome || "Ready to chat"
  readonly property string activityDetail: !running ? "Start the bridge below to reconnect."
    : assistantState === "Listening" ? "Microphone is recording. Finish recording to send."
    : assistantState === "Transcribing" ? "Turning your recording into text."
    : assistantState === "Sending" ? "Sending your message to the local bridge."
    : assistantState === "Thinking" ? (activitySeconds >= 20 ? "Still waiting for the agent. You can stop this request." : "Your agent is processing the request. Reply text will appear below.")
    : assistantState === "Responding" ? "New reply text is arriving below."
    : assistantState === "Preparing voice" ? "Generating speech from the reply."
    : assistantState === "Speaking" ? "Playing the reply. Stop interrupts playback."
    : assistantState === "Stopping" ? "Cancelling the current request."
    : remoteBusy ? "This conversation is being used on your phone or another device."
    : lastOutcome === "Failed" ? "See the error below. You can send another message."
    : lastOutcome === "Stopped" ? "Request interrupted. Ready for your next message."
    : lastOutcome === "Reply complete" ? "Ready for your next message."
    : "Type a message or use the microphone."
  onActivityActiveChanged: {
    if (root.activityActive) { root.activityStarted = Date.now(); root.activitySeconds = 0 }
    else if (root.activityStarted > 0) root.activitySeconds = Math.floor((Date.now() - root.activityStarted) / 1000)
  }
  property bool confirmReset: false
  property bool readAloud: false
  property var attachments: []
  property var messages: []
  property string streamText: ""
  property bool remoteBusy: false
  property string historyAgent: ""
  property string historySignature: ""
  property var profile: ({ assistantName: "JARVIS", userName: "" })
  property bool savingPersonality: false
  property var modelListing: ({ id: "", listed: false, models: [] })
  property string modelBusy: ""
  Controls.Popup {
    id: personalityEditor
    property int revision: 0
    parent: panelContent
    anchors.centerIn: parent
    width: Math.max(200, panelContent.width - Style.space(16))
    height: Math.min(panelContent.height - Style.space(16), Style.space(520))
    modal: true
    padding: Style.space(16)
    background: Rectangle { color: OmarchyCommons.Color.background; border.color: OmarchyCommons.Color.accent; radius: Style.cornerRadius }
    contentItem: Controls.ScrollView {
      clip: true
      contentWidth: availableWidth
      ColumnLayout {
        width: parent.width
        spacing: Style.space(10)
        Text { textFormat: Text.PlainText; text: "Personality"; color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.title }
        Text { textFormat: Text.PlainText; text: "Assistant name"; color: root.fg; font.family: root.fontFamily }
        Controls.TextField {
          id: assistantNameField; Layout.fillWidth: true; maximumLength: 80; color: root.fg; selectByMouse: true; Accessible.name: "Assistant name"
          background: Rectangle { color: "transparent"; border.color: OmarchyCommons.Color.muted; radius: Style.cornerRadius }
        }
        Text { textFormat: Text.PlainText; text: "Personality prompt"; color: root.fg; font.family: root.fontFamily }
        Controls.TextArea {
          id: personalityField
          Layout.fillWidth: true
          Layout.preferredHeight: Style.space(150)
          wrapMode: TextEdit.Wrap
          color: root.fg
          selectByMouse: true
          textFormat: TextEdit.PlainText
          onTextChanged: { if (text.length > 8000) text = text.slice(0, 8000) }
          background: Rectangle { color: "transparent"; border.color: OmarchyCommons.Color.muted; radius: Style.cornerRadius }
          Accessible.name: "Personality prompt"
        }
        Text { textFormat: Text.PlainText; text: "Your name"; color: root.fg; font.family: root.fontFamily }
        Controls.TextField {
          id: userNameField; Layout.fillWidth: true; maximumLength: 80; color: root.fg; selectByMouse: true; Accessible.name: "Your name"
          background: Rectangle { color: "transparent"; border.color: OmarchyCommons.Color.muted; radius: Style.cornerRadius }
        }
        Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: "Applies to desktop and phone on your next request."; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.family: root.fontFamily }
        Text { textFormat: Text.PlainText; Layout.fillWidth: true; visible: root.notice !== ""; text: root.notice; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.urgent; font.family: root.fontFamily }
        RowLayout {
          Layout.fillWidth: true
          Ui.Button { text: "Cancel"; bordered: true; enabled: !root.savingPersonality; onClicked: personalityEditor.close() }
          Ui.Button {
            text: root.savingPersonality ? "Saving…" : "Save"
            bordered: true
            enabled: !root.savingPersonality && !root.working && !root.remoteBusy
            onClicked: {
              root.savingPersonality = true
              root.command({action: "savePersonality", profile: {assistantName: assistantNameField.text, personality: personalityField.text, userName: userNameField.text, revision: personalityEditor.revision}})
            }
          }
        }
      }
    }
  }
  readonly property var agent: status.agent || ({})
  readonly property bool agentModelPickable: agent.modelSelectable === true && modelListing.listed === true
  readonly property bool modelRowVisible: agent.modelSelectable === true && modelListing.agent === agent.id && (modelListing.listed === true || (modelListing.note || "") !== "")
  readonly property var tunnel: status.tunnel || ({})
  readonly property bool running: status.running === true
  readonly property bool working: assistantState !== "Ready"
  readonly property bool tunnelUp: tunnel.state === "up" && !!tunnel.url
  readonly property string link: qrTailscale ? String(status.tailscaleUrl || "") : qrLan ? String(status.lanUrl || "") : String(status.tunnelUrl || "")
  readonly property color fg: bar ? bar.foreground : OmarchyCommons.Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string jarvisBin: (Quickshell.env("HOME") || "") + "/.local/bin/jarvis"

  function open() {
    root.controller.show()
    root.refresh()
    if (!setupProc.running) setupProc.running = true
    if (!desktop.running) desktop.running = true
    else { root.command({ action: "history" }); root.command({ action: "models" }) }
    Qt.callLater(function() { if (root.tab === 0) input.forceActiveFocus() })
  }
  function close() {
    personalityEditor.close()
    if (root.assistantState === "Listening") root.command({ action: "stop" })
    root.controller.hide()
  }
  function toggle() { if (root.opened) root.close(); else root.open() }
  function closeForPopoutSwitch() {
    root.popoutSwitchClosing = true
    root.close()
    Qt.callLater(function() { root.popoutSwitchClosing = false })
  }
  function refresh() { if (!statusProc.running) statusProc.running = true }
  function applyStatus(payload) {
    root.status = payload || ({})
    root.statusLoaded = true
    if (root.agent.modelSelectable === true && root.modelListing.agent !== root.agent.id) root.command({ action: "models" })
    if (!root.running) { root.qrImage = ""; root.qrForUrl = ""; return }
    if (root.opened && root.link && root.qrForUrl !== root.link) root.loadQr()
  }
  function loadQr() {
    if (qrProc.running || !root.running || !root.link) return
    root.qrImage = ""
    root.qrError = ""
    root.qrTimedOut = false
    root.qrRequestUrl = root.link
    root.qrRequestLan = root.qrLan
    qrProc.command = [root.jarvisBin, "qr", "--json", root.qrTailscale ? "--tailscale" : root.qrLan ? "--lan" : "--tunnel"]
    qrProc.running = true
  }
  function setTarget(lan, tailscale) {
    root.qrTailscale = tailscale === true
    root.qrLan = lan
    root.qrImage = ""
    root.qrForUrl = ""
    root.qrError = ""
    root.loadQr()
  }
  function command(payload) {
    if (!desktop.running) { root.savingPersonality = false; root.notice = "Assistant is reconnecting. Try again."; desktop.running = true; return }
    desktop.write(JSON.stringify(payload) + "\n")
  }
  function send() {
    var text = input.text.trim()
    if ((!text && !root.attachments.length) || root.working || root.remoteBusy || !root.running) return
    root.notice = ""
    root.streamText = ""
    root.lastOutcome = ""
    root.assistantState = "Sending"
    root.messages = root.messages.concat([{ role: "user", text: text + (root.attachments.length ? "\n[Attached: " + root.attachments.map(function(f) { return f.name }).join(", ") + "]" : "") }])
    input.text = ""
    root.command({ action: "send", text: text })
    transcript.positionViewAtEnd()
  }
  function handleEvent(data) {
    if (data.event === "attachments") {
      root.attachments = data.files || []
    } else if (data.event === "clipboardText") {
      input.insert(input.cursorPosition, data.text || "")
    } else if (data.event === "ready") {
      root.command({ action: "readAloud", enabled: root.readAloud })
      root.command({ action: "history" })
      root.command({ action: "models" })
    } else if (data.event === "history") {
      if (data.profile) root.profile = data.profile
      root.remoteBusy = data.busy === true
      if (data.busy && root.working) return
      var signature = JSON.stringify([data.agent, data.messages])
      if (signature !== root.historySignature) {
        var follow = transcript.atYEnd || root.messages.length === 0
        root.historySignature = signature
        root.historyAgent = data.agent || ""
        root.messages = data.messages || []
        if (!data.busy) root.streamText = ""
        if (follow) Qt.callLater(function() { transcript.positionViewAtEnd() })
      }
    } else if (data.event === "personality") {
      root.profile = data.profile
      root.savingPersonality = false
      if (data.saved) { personalityEditor.close(); root.notice = "Personality saved" }
      else {
        personalityEditor.revision = data.profile.revision
        assistantNameField.text = data.profile.assistantName || "JARVIS"
        personalityField.text = data.profile.personality || ""
        userNameField.text = data.profile.userName || ""
        root.notice = ""
        personalityEditor.open()
      }
    } else if (data.event === "models") {
      root.modelListing = data && typeof data === "object" ? data : ({ id: "", listed: false, models: [] })
      root.modelBusy = ""
      var selected = ""
      for (var m = 0; m < (root.modelListing.models || []).length; m++) { if (root.modelListing.models[m].selected) { selected = root.modelListing.models[m].id; break } }
      var snapshot = root.status
      if (snapshot.agent && snapshot.agent.modelSelectable) { snapshot.agent.model = selected; root.status = snapshot }
    } else if (data.event === "state") {
      root.assistantState = data.state || "Ready"
      if (root.assistantState === "Thinking" || root.assistantState === "Listening" || root.assistantState === "Transcribing") root.lastOutcome = ""
      if (!root.working) root.command({ action: "history" })
    } else if (data.event === "heard") {
      root.messages = root.messages.concat([{ role: "user", text: data.text }])
    } else if (data.event === "token") {
      if (data.text) root.assistantState = "Responding"
      var followStream = transcript.atYEnd
      root.streamText += data.text || ""
      if (followStream) Qt.callLater(function() { transcript.positionViewAtEnd() })
    } else if (data.event === "done") {
      root.lastOutcome = "Reply complete"
      root.assistantState = "Finishing"
      root.streamText = data.text || root.streamText
    } else if (data.event === "error") {
      root.savingPersonality = false
      root.modelBusy = ""
      root.notice = data.error || "Assistant failed"
      root.lastOutcome = /stop|abort|cancel/i.test(root.notice) ? "Stopped" : "Failed"
    }
  }
  function modelOptions() {
    var found = [{ value: "", label: "Agent default" }]
    var list = root.modelListing.models || []
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      found.push({ value: entry.id, label: entry.free ? entry.id + " (free)" : entry.id, description: entry.free ? "free" : "" })
    }
    return found
  }
  function chooseModel(value) {
    var current = (root.modelListing.models || []).some(function(m) { return m.selected && m.id === value })
    if (current) return
    root.modelBusy = "Saving model"
    root.command({ action: "setModel", model: value })
  }
  function launchSetup() {
    Quickshell.execDetached(["omarchy-launch-terminal", "bash", "-c",
      'if [ -x "$1" ]; then "$1" setup; else bash "$2" --no-plugin; fi; result=$?; printf "\nSetup finished (exit %s). Press Enter to close.\n" "$result"; read -r ignored; exit "$result"',
      "jarvis-setup", root.jarvisBin, (Quickshell.env("HOME") || "") + "/.config/omarchy/plugins/h3man.jarvis/install.sh"])
  }
  function run(action) {
    if (actionProc.running) return
    root.busy = true
    actionProc.command = [root.jarvisBin, action]
    actionProc.running = true
  }
  function copyLink() {
    if (!root.link) return
    copyProc.command = ["wl-copy"]
    copyProc.running = true
    copyProc.write(root.link)
    copyProc.closeWriteChannel()
    root.notice = "Phone link copied"
  }
  Timer {
    interval: 1000
    repeat: true
    running: root.activityActive && root.opened
    onTriggered: root.activitySeconds = Math.floor((Date.now() - root.activityStarted) / 1000)
  }
  Process {
    id: desktop
    command: [root.jarvisBin, "desktop"]
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { try { root.handleEvent(JSON.parse(line)) } catch(e) { root.notice = "Invalid assistant response" } } }
    stderr: StdioCollector { id: desktopErr; waitForEnd: true }
    onExited: function(code) {
      root.savingPersonality = false
      root.assistantState = "Ready"
      if (code !== 0) root.lastOutcome = "Failed"
      if (code !== 0) root.notice = "Assistant disconnected: " + (desktopErr.text || "restart the bridge").trim().slice(0, 120)
    }
  }
  Process {
    id: setupProc
    command: ["sh", "-c", "if [ -x \"$1\" ]; then exec \"$1\" setup-status; elif [ -f \"$2/server/setup.mjs\" ]; then exec node \"$2/server/setup.mjs\" --check; else printf '%s\\n' '{\"configured\":false,\"voiceReady\":false}'; fi", "jarvis-setup-status", root.jarvisBin, (Quickshell.env("HOME") || "") + "/.config/omarchy/plugins/h3man.jarvis"]
    stdout: StdioCollector { id: setupOut; waitForEnd: true }
    onExited: function(code) {
      try { root.setup = code === 0 ? JSON.parse(setupOut.text || "{}") : ({ configured: false, voiceReady: false }) }
      catch(e) { root.setup = ({ configured: false, voiceReady: false }) }
      root.setupLoaded = true
    }
  }
  Timer { interval: 15000; running: root.opened; repeat: true; onTriggered: { if (!setupProc.running) setupProc.running = true } }
  Process {
    id: statusProc
    command: [root.jarvisBin, "status", "--json"]
    stdout: StdioCollector { id: statusOut; waitForEnd: true }
    onExited: function(code) {
      try { root.applyStatus(code === 0 ? JSON.parse(statusOut.text || "{}") : {}) }
      catch(e) { root.applyStatus({}) }
    }
  }
  Process {
    id: qrProc
    stdout: StdioCollector { id: qrOut; waitForEnd: true }
    stderr: StdioCollector { id: qrErr; waitForEnd: true }
    onExited: function(code) {
      if (root.qrRequestUrl !== root.link || root.qrRequestLan !== root.qrLan) { Qt.callLater(root.loadQr); return }
      if (code !== 0 || root.qrTimedOut) { root.qrError = root.qrTimedOut ? "QR generation timed out" : (qrErr.text || "QR generation failed").trim().slice(0, 120); return }
      try {
        var payload = JSON.parse(qrOut.text)
        if (!payload.image || !payload.size || payload.url !== root.link) throw new Error("Link changed; retrying")
        root.matrixSize = payload.size
        root.qrImage = payload.image
        root.qrForUrl = payload.url
      } catch(e) { root.qrError = "Unable to build QR. Press Retry." }
    }
  }
  Timer { interval: 15000; running: qrProc.running; onTriggered: { root.qrTimedOut = true; qrProc.running = false } }
  Process {
    id: actionProc
    stdout: StdioCollector { id: actionOut; waitForEnd: true }
    stderr: StdioCollector { id: actionErr; waitForEnd: true }
    onExited: function(code) {
      root.busy = false
      root.notice = (actionOut.text || actionErr.text || (code === 0 ? "" : "Bridge command failed")).trim()

      root.refresh()
    }
  }
  Process { id: copyProc; stdinEnabled: true }
  Timer {
    interval: 2500; running: root.opened; repeat: true
    onTriggered: {
      root.refresh()
      if (desktop.running && !root.working) root.command({ action: "history" })
    }
  }

  Timer { id: resetTimer; interval: 5000; onTriggered: root.confirmReset = false }

  Ui.KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: root.tab === 0 ? input : keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(Style.space(680))
    Ui.PanelKeyCatcher { id: keyCatcher; anchors.fill: parent; blocked: modelPicker.popupOpen; onCloseRequested: root.close() }
    ColumnLayout {
      id: panelContent
      anchors.fill: parent
      spacing: Style.space(12)
      RowLayout {
        Layout.fillWidth: true
        ColumnLayout {
          Layout.fillWidth: true
          spacing: Style.space(3)
          Text { textFormat: Text.PlainText; text: root.profile.assistantName || "JARVIS"; color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true; font.letterSpacing: 2; Layout.fillWidth: true; elide: Text.ElideRight }
          Text { textFormat: Text.PlainText; text: root.agent.label || "Omarchy agent"; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
        }
        Ui.Button { text: "Personality"; bordered: true; focusable: true; enabled: root.running; onClicked: root.command({action: "personality"}) }
        Text { textFormat: Text.PlainText; text: !root.statusLoaded ? "Checking" : root.running ? "Online" : "Offline"; color: root.running ? OmarchyCommons.Color.accent : OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
      }
      RowLayout {
        Layout.fillWidth: true
        Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: "Assistant"; selected: root.tab === 0; bordered: true; onClicked: { root.tab = 0; Qt.callLater(function() { input.forceActiveFocus() }) } }
        Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: "Phone"; selected: root.tab === 1; bordered: true; onClicked: { root.tab = 1; root.qrImage = ""; root.qrForUrl = ""; root.refresh(); root.loadQr() } }
      }
      Ui.PanelSeparator { Layout.fillWidth: true }
      RowLayout {
        Layout.fillWidth: true
        visible: root.modelRowVisible
        spacing: Style.space(8)
        Text { textFormat: Text.PlainText; text: "Model"; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption; font.bold: true }
        Ui.SearchableDropdown {
          id: modelPicker
          visible: root.agentModelPickable
          Layout.fillWidth: true
          showLabel: false
          value: root.agent.model || ""
          triggerLabel: root.agent.model ? root.agent.model : "Agent default"
          options: root.modelOptions()
          onChanged: function(value) { root.chooseModel(String(value)) }
        }
        Text { textFormat: Text.PlainText; visible: root.modelBusy !== "" && root.agentModelPickable; text: root.modelBusy; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
        Text { textFormat: Text.PlainText; visible: root.agent.modelSelectable === true && !root.agentModelPickable && (root.modelListing.note || "") !== ""; Layout.fillWidth: true; text: root.modelListing.note; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
      }
      StackLayout {
        Layout.fillWidth: true
        Layout.fillHeight: true
        currentIndex: root.tab
        ColumnLayout {
          spacing: Style.space(10)
          ColumnLayout {
            Layout.fillWidth: true
            visible: root.setupLoaded && (!root.setup.configured || !root.setup.voiceReady)
            spacing: Style.space(6)
            Text { textFormat: Text.PlainText;
              Layout.fillWidth: true
              text: !root.setup.configured ? "Welcome to JARVIS" : "Finish voice setup"
              color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.body; font.bold: true
            }
            Text { textFormat: Text.PlainText;
              Layout.fillWidth: true
              text: "Setup checks for existing local models and asks before installing anything. You can skip voice models and use text chat."
              wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption
            }
            Ui.Button { Layout.fillWidth: true; text: "Open setup"; bordered: true; focusable: true; onClicked: root.launchSetup() }
          }
          Rectangle {
            Layout.fillWidth: true
            implicitHeight: activityContent.implicitHeight + Style.space(24)
            radius: Style.cornerRadius
            color: "transparent"
            border.width: 1
            border.color: root.activityActive ? OmarchyCommons.Color.accent : OmarchyCommons.Color.muted
            ColumnLayout {
              id: activityContent
              anchors.fill: parent
              anchors.margins: Style.space(12)
              spacing: Style.space(7)
              RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(8)
                Rectangle {
                  implicitWidth: Style.space(8); implicitHeight: width; radius: width / 2
                  color: root.assistantState === "Listening" || root.lastOutcome === "Failed" ? OmarchyCommons.Color.urgent : root.running ? OmarchyCommons.Color.accent : OmarchyCommons.Color.muted
                  SequentialAnimation on opacity {
                    running: root.activityActive && root.opened
                    loops: Animation.Infinite
                    NumberAnimation { from: 1; to: 0.3; duration: 650 }
                    NumberAnimation { from: 0.3; to: 1; duration: 650 }
                  }
                  opacity: root.activityActive ? 0.8 : 1
                }
                Text { textFormat: Text.PlainText;
                  Layout.fillWidth: true
                  text: root.activityTitle
                  color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.body; font.bold: true
                  elide: Text.ElideRight
                  Accessible.name: text
                }
                Text { textFormat: Text.PlainText;
                  visible: root.activityActive || root.lastOutcome !== ""
                  text: root.activitySeconds < 60 ? root.activitySeconds + "s" : Math.floor(root.activitySeconds / 60) + "m " + (root.activitySeconds % 60) + "s"
                  color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption
                }
              }
              Text { textFormat: Text.PlainText;
                Layout.fillWidth: true
                text: root.activityDetail
                wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption
              }
              Rectangle {
                Layout.fillWidth: true
                id: activityRail
                implicitHeight: Style.space(3)
                visible: root.activityActive
                color: OmarchyCommons.Color.muted
                opacity: 0.7
                clip: true
                Rectangle {
                  width: parent.width * 0.25; height: parent.height; color: OmarchyCommons.Color.accent
                  NumberAnimation on x {
                    from: -activityRail.width * 0.25; to: activityRail.width
                    duration: 1300; loops: Animation.Infinite
                    running: root.activityActive && root.opened
                  }
                }
              }
            }
          }
          ListView {
            id: transcript
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: Style.space(14)
            model: root.messages
            Controls.ScrollBar.vertical: Controls.ScrollBar {}
            delegate: Column {
              required property var modelData
              width: transcript.width - Style.space(12)
              spacing: Style.space(4)
              Text { textFormat: Text.PlainText; text: modelData.role === "user" ? (root.profile.userName || "YOU") : modelData.role === "assistant" ? (root.profile.assistantName || "JARVIS") : "SYSTEM"; color: modelData.role === "user" ? OmarchyCommons.Color.muted : OmarchyCommons.Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.caption; font.bold: true }
              TextEdit { width: parent.width; text: modelData.text || ""; readOnly: true; selectByMouse: true; wrapMode: TextEdit.Wrap; textFormat: TextEdit.PlainText; color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.body }
            }
            footer: Item {
              width: transcript.width - Style.space(12)
              height: root.streamText ? streamingReply.implicitHeight + Style.space(12) : root.waitingForReply ? pendingReply.implicitHeight + Style.space(16) : 0
              Row {
                id: pendingReply
                visible: root.waitingForReply && !root.streamText
                spacing: Style.space(8)
                Text { textFormat: Text.PlainText; text: "JARVIS"; color: OmarchyCommons.Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.caption; font.bold: true }
                Repeater {
                  model: 3
                  Rectangle {
                    required property int index
                    width: Style.space(4); height: width; radius: width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    color: OmarchyCommons.Color.accent
                    SequentialAnimation on opacity {
                      running: root.waitingForReply && root.opened
                      loops: Animation.Infinite
                      PauseAnimation { duration: index * 140 }
                      NumberAnimation { from: 0.25; to: 1; duration: 300 }
                      NumberAnimation { from: 1; to: 0.25; duration: 300 }
                      PauseAnimation { duration: (2 - index) * 140 }
                    }
                  }
                }
              }
              Text { textFormat: Text.PlainText;
                id: streamingReply
                width: parent.width
                text: root.streamText
                wrapMode: Text.WordWrap
                color: root.fg
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
            }
            Ui.Button {
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              visible: !transcript.atYEnd && root.messages.length > 0
              text: "Jump to latest ↓"; bordered: true; focusable: true
              onClicked: transcript.positionViewAtEnd()
            }
            Text { textFormat: Text.PlainText; anchors.centerIn: parent; width: parent.width * 0.8; visible: root.messages.length === 0 && !root.streamText && !root.working; text: "What can I help with?\nType below or tap the microphone.\nSuper + Ctrl + J opens JARVIS."; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.body }
          }
          ColumnLayout {
            Layout.fillWidth: true
            Repeater {
              model: root.attachments
              RowLayout {
                required property var modelData
                Layout.fillWidth: true
                Text { Layout.fillWidth: true; text: modelData.name + " (" + Math.ceil(modelData.size / 1024) + " KB)"; textFormat: Text.PlainText; elide: Text.ElideMiddle; color: root.fg; font.family: root.fontFamily }
                Ui.Button { text: "Remove"; bordered: true; enabled: !root.working; onClicked: root.command({action:"removeAttachment", id:modelData.id}) }
              }
            }
            Text { Layout.fillWidth: true; text: "Files are shared with your selected agent. Up to 4 files, 10 MB each."; textFormat: Text.PlainText; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.muted; font.pixelSize: Style.font.bodySmall }
            RowLayout {
              Ui.Button { text: "Attach files"; bordered: true; enabled: root.running && !root.working && !root.remoteBusy && root.attachments.length < 4; onClicked: root.command({action:"attachFiles"}) }
              Ui.Button { text: "Paste image"; bordered: true; enabled: root.running && !root.working && !root.remoteBusy && root.attachments.length < 4; onClicked: root.command({action:"pasteClipboard", imageOnly:true}) }
            }
          }
          RowLayout {
            Layout.fillWidth: true
            Controls.TextArea {
              id: input
              Layout.fillWidth: true
              Layout.preferredHeight: Style.space(76)
              leftPadding: Style.space(10)
              rightPadding: Style.space(10)
              placeholderText: "Message " + (root.profile.assistantName || "JARVIS") + "… (Shift+Enter for a new line)"
              wrapMode: TextEdit.Wrap
              onTextChanged: {
                var limit = root.status.limits ? root.status.limits.maxTextChars : 4000
                if (text.length > limit) text = text.slice(0, limit)
              }
              color: root.fg
              placeholderTextColor: OmarchyCommons.Color.muted
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              selectByMouse: true
              enabled: root.running
              background: Rectangle { color: "transparent"; radius: Style.cornerRadius; border.width: 1; border.color: input.activeFocus ? OmarchyCommons.Color.accent : OmarchyCommons.Color.muted }
              Keys.onPressed: function(event) {
                if (event.matches(StandardKey.Paste)) {
                  event.accepted = true
                  if (!root.working && !root.remoteBusy) root.command({action:"pasteClipboard"})
                }
              }
              Keys.onReturnPressed: function(event) {
                if (!(event.modifiers & Qt.ShiftModifier)) { root.send(); event.accepted = true }
                else event.accepted = false
              }
              Keys.onEnterPressed: function(event) {
                if (!(event.modifiers & Qt.ShiftModifier)) { root.send(); event.accepted = true }
                else event.accepted = false
              }
              Keys.onEscapePressed: root.close()
            }
            Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              text: "Send"; bordered: true; enabled: root.running && !root.working && !root.remoteBusy && (input.text.trim() !== "" || root.attachments.length > 0); onClicked: root.send() }
          }
          RowLayout {
            Layout.fillWidth: true
            Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true
              text: root.assistantState === "Listening" ? "Finish recording" : "Microphone"
              selected: root.assistantState === "Listening"
              bordered: true
              enabled: root.running && (!root.working || root.assistantState === "Listening") && !root.remoteBusy
              onClicked: { root.notice = ""; root.lastOutcome = ""; root.command({ action: "record" }) }
            }
            Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              text: "Stop"; bordered: true; enabled: root.working || root.remoteBusy
              onClicked: { root.lastOutcome = "Stopped"; root.assistantState = "Stopping"; root.command({ action: "stop" }) }
            }
            Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              text: "Read aloud"; bordered: true; selected: root.readAloud
              onClicked: { root.readAloud = !root.readAloud; root.command({ action: "readAloud", enabled: root.readAloud }) }
            }
          }
          Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: root.confirmReset ? "Confirm: clear shared conversation" : "New conversation"; bordered: true; enabled: root.running && !root.working && !root.remoteBusy; onClicked: { if (root.messages.length && !root.confirmReset) { root.confirmReset = true; resetTimer.restart(); return }; root.confirmReset = false; root.notice = ""; root.lastOutcome = ""; root.command({ action: "reset" }) } }
        }
        Flickable {
          id: phoneScroll
          clip: true
          contentWidth: width
          contentHeight: phoneLayout.implicitHeight
          Controls.ScrollBar.vertical: Controls.ScrollBar {}
          ColumnLayout {
            id: phoneLayout
            width: phoneScroll.width
            spacing: Style.space(12)
            RowLayout {
              Layout.alignment: Qt.AlignHCenter
              Ui.Button {
                focusable: true; Keys.onEscapePressed: root.close()
                text: "Cloudflare"; bordered: true; selected: !root.qrLan && !root.qrTailscale
                onClicked: root.setTarget(false, false)
              }
              Ui.Button {
                focusable: true; Keys.onEscapePressed: root.close()
                text: "LAN"; bordered: true; selected: root.qrLan && !root.qrTailscale
                onClicked: root.setTarget(true, false)
              }
              Ui.Button {
                focusable: true; Keys.onEscapePressed: root.close()
                text: "Tailscale"; bordered: true; selected: root.qrTailscale
                onClicked: root.setTarget(false, true)
              }
            }
            Text { textFormat: Text.PlainText;
              Layout.fillWidth: true; visible: root.qrTailscale
              text: "Private Tailscale tunnel · " + (root.status.tailscale ? root.status.tailscale.state : "checking")
              color: OmarchyCommons.Color.accent; wrapMode: Text.WordWrap; font.family: root.fontFamily; font.pixelSize: Style.font.body
            }
            Ui.Button {
              visible: root.qrTailscale; Layout.fillWidth: true
              text: root.busy ? "Enabling…" : "Enable Tailscale tunnel"; bordered: true
              enabled: !root.busy && root.running; focusable: true; Keys.onEscapePressed: root.close()
              onClicked: root.run("tailscale-enable")
            }
            Ui.Button {
              visible: root.qrTailscale && /https:\/\/login\.tailscale\.com\/\S+/.test(root.notice)
              text: "Enable HTTPS in Tailscale"; bordered: true; Layout.fillWidth: true
              onClicked: { var match = root.notice.match(/https:\/\/login\.tailscale\.com\/\S+/); if (match) Qt.openUrlExternally(match[0]) }
            }
            Rectangle {
              Layout.fillWidth: true
              Layout.preferredHeight: Math.min(Style.space(300), width)
              color: "white"
              Image {
                anchors.centerIn: parent
                width: root.matrixSize > 0 ? Math.floor(Math.min(parent.width, parent.height) / root.matrixSize) * root.matrixSize : 0
                height: width
                source: root.qrForUrl === root.link ? root.qrImage : ""
                smooth: false
                mipmap: false
                cache: false
                onStatusChanged: { if (status === Image.Error) root.qrError = "QR image could not be displayed. Press Retry." }
              }
              Text { textFormat: Text.PlainText;
                anchors.centerIn: parent
                width: parent.width - Style.space(30)
                visible: !root.qrImage || root.qrForUrl !== root.link
                text: !root.running ? "Start the bridge first" : root.qrError || (root.qrTailscale && !root.link ? (root.status.tailscale ? root.status.tailscale.error : "Checking Tailscale…") : qrProc.running ? "Generating QR…" : !root.qrLan && !root.tunnelUp ? (root.tunnel.enabled ? "Cloudflare connecting…" : "Cloudflare is disabled. Open Setup to enable it.") : "Preparing phone link…")
                horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; color: "#333333"; font.family: root.fontFamily; font.pixelSize: Style.font.body
              }
            }
            Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: root.qrImage && root.qrForUrl === root.link ? "Ready to scan" : root.qrError ? "QR needs attention" : "Connecting"; horizontalAlignment: Text.AlignHCenter; color: OmarchyCommons.Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: "Your phone and desktop share the same conversation."; color: root.fg; wrapMode: Text.WordWrap; font.family: root.fontFamily; font.pixelSize: Style.font.body }
            Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: root.qrTailscale ? "Connect Tailscale on your phone to the same tailnet. Scan once, then choose Add to Home Screen or Install app in your browser. This address survives restarts while the machine name and tailnet stay the same." : root.qrLan ? "Same Wi-Fi only. Accept the local certificate in your phone browser, then allow microphone access." : "Scan with your phone camera, open in your browser, and allow microphone access. The tunnel link changes on restart."; color: OmarchyCommons.Color.muted; wrapMode: Text.WordWrap; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: root.link ? root.link.replace(/\?.*$/, "") : "Waiting for a phone link"; color: OmarchyCommons.Color.muted; elide: Text.ElideMiddle; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            RowLayout {
              Layout.fillWidth: true
              Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: "Retry"; bordered: true; enabled: !qrProc.running; onClicked: { root.refresh(); root.loadQr() } }
              Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: "Copy link"; bordered: true; enabled: root.link !== ""; onClicked: root.copyLink() }
              Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              Layout.fillWidth: true; text: "Open"; bordered: true; enabled: root.link !== ""; onClicked: Qt.openUrlExternally(root.link) }
            }
            Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: "Voice input: " + (root.status.stt && root.status.stt.ready ? "ready" : "unavailable") + " · Voice output: " + (root.status.tts && root.status.tts.ready ? "ready" : "unavailable"); color: OmarchyCommons.Color.muted; wrapMode: Text.WordWrap; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
          }
        }
      }
      Text { textFormat: Text.PlainText; Layout.fillWidth: true; visible: root.notice !== ""; text: root.notice; wrapMode: Text.WordWrap; color: OmarchyCommons.Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
      Ui.PanelSeparator { Layout.fillWidth: true }
      RowLayout {
        Layout.fillWidth: true
        Ui.Button { text: "Setup"; bordered: true; focusable: true; onClicked: root.launchSetup() }
        Text { textFormat: Text.PlainText; Layout.fillWidth: true; text: "Local voice bridge"; color: OmarchyCommons.Color.muted; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
        Ui.Button {
              focusable: true
              Keys.onEscapePressed: root.close()
              text: root.busy ? "Working…" : root.running ? "Stop bridge" : "Start bridge"; bordered: true; enabled: !root.busy; onClicked: root.run(root.running ? "stop" : "start") }
      }
    }
  }
}
