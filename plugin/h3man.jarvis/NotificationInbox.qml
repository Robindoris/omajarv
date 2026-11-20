pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import qs.Commons
import qs.Commons as OmarchyCommons
import qs.Ui as Ui

ColumnLayout {
  id: root
  property var items: []
  property bool loaded: false
  property bool available: false
  property bool busy: false
  property string error: ""
  property var details: null
  signal action(string action, string notificationId, int minutes)
  signal refresh()
  spacing: Style.space(10)
  RowLayout {
    Layout.fillWidth: true
    Text { Layout.fillWidth: true; text: "Calendar reminders"; textFormat: Text.PlainText; color: OmarchyCommons.Color.foreground; font.pixelSize: Style.font.title; elide: Text.ElideRight }
    Ui.Button { text: "Refresh"; focusable: true; bordered: true; enabled: !root.busy; onClicked: root.refresh() }
  }
  Text {
    Layout.fillWidth: true
    visible: !root.loaded || !root.available || root.error !== ""
    text: root.error || (!root.loaded ? "Loading calendar reminders…" : "Offline · showing last saved reminders")
    textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
    color: OmarchyCommons.Color.muted
    Accessible.role: Accessible.StaticText
  }
  Controls.ScrollView {
    Layout.fillWidth: true; Layout.fillHeight: true
    clip: true; contentWidth: availableWidth
    ColumnLayout {
      width: parent.width
      spacing: Style.space(12)
      Text { visible: root.loaded && root.available && !root.items.length; text: "No calendar reminders."; color: OmarchyCommons.Color.muted }
      Repeater {
        model: root.items
        ColumnLayout {
          id: row
          required property var modelData
          Layout.fillWidth: true
          spacing: Style.space(6)
          Text { Layout.fillWidth: true; text: (row.modelData.read ? "" : "Unread · ") + row.modelData.title; textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; font.bold: !row.modelData.read; color: OmarchyCommons.Color.foreground }
          Text { Layout.fillWidth: true; text: row.modelData.body; textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; color: OmarchyCommons.Color.muted }
          ColumnLayout {
            Layout.fillWidth: true
            Ui.Button { text: "Show event details"; focusable: true; bordered: true; enabled: root.available && !root.busy; onClicked: root.action("notificationDetails", row.modelData.id, 0) }
            RowLayout {
              Ui.Button { text: "Mark read"; visible: !row.modelData.read; focusable: true; bordered: true; enabled: root.available && !root.busy; onClicked: root.action("notificationRead", row.modelData.id, 0) }
              Ui.Button { text: "Snooze 15 min"; focusable: true; bordered: true; enabled: root.available && !root.busy; onClicked: root.action("notificationSnooze", row.modelData.id, 15) }
              Ui.Button { text: "Dismiss"; focusable: true; bordered: true; enabled: root.available && !root.busy; onClicked: root.action("notificationDismiss", row.modelData.id, 0) }
            }
          }
          Text {
            Layout.fillWidth: true
            visible: root.details !== null && root.details.id === row.modelData.id
            text: visible ? root.details.event.title + "\n" + root.details.event.notes + "\n" + new Date(root.details.event.startAt).toLocaleString() + " – " + new Date(root.details.event.endAt).toLocaleString() + " (device local time)\nEvent time zone: " + root.details.event.timeZone : ""
            textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; color: OmarchyCommons.Color.foreground
          }
          Ui.PanelSeparator { Layout.fillWidth: true }
        }
      }
    }
  }
}
