import QtQuick

// Never let Qt synchronously fetch CLIPBOARD/PRIMARY in the shared shell.
// The parent forwards keys here before its native TextInput/TextEdit handler.
Item {
  id: guard
  signal pasteRequested(bool primary)
  Keys.onPressed: function(event) {
    if (event.matches(StandardKey.Paste)) {
      event.accepted = true
      if (!event.isAutoRepeat) guard.pasteRequested(false)
    }
  }
  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.MiddleButton | Qt.RightButton
    onPressed: function(mouse) {
      mouse.accepted = true
      if (mouse.button === Qt.MiddleButton) guard.pasteRequested(true)
    }
    // Right-click is consumed too: a native context-menu Paste would bypass
    // the bounded helper. Left-button cursor positioning/selection is unchanged.
  }
}
