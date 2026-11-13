import QtQuick
import QtQuick.Controls
import QtTest
import "../../plugin/h3man.jarvis"

Item {
  width: 400; height: 300
  property var pastes: []
  TextArea {
    id: area
    width: 200; height: 80
    text: "fixture"; selectByMouse: true
    Keys.priority: Keys.BeforeItem
    Keys.forwardTo: [areaGuard]
    PasteGuard { id: areaGuard; anchors.fill: parent; onPasteRequested: function(primary) { pastes.push(primary) } }
  }
  TextField {
    id: field
    y: 100; width: 200; height: 60
    text: "fixture"; selectByMouse: true
    Keys.priority: Keys.BeforeItem
    Keys.forwardTo: [fieldGuard]
    PasteGuard { id: fieldGuard; anchors.fill: parent; onPasteRequested: function(primary) { pastes.push(primary) } }
  }
  TestCase {
    name: "BoundedPasteRouting"
    when: windowShown
    function test_routing_data() { return [{tag:"area", editor:area}, {tag:"field", editor:field}] }
    function test_routing(data) {
      pastes = []
      data.editor.forceActiveFocus()
      keyClick(Qt.Key_V, Qt.ControlModifier)
      keyClick(Qt.Key_Insert, Qt.ShiftModifier)
      mouseClick(data.editor, 20, 20, Qt.MiddleButton)
      compare(JSON.stringify(pastes), "[false,false,true]")
      compare(data.editor.text, "fixture")
      mouseClick(data.editor, 20, 20, Qt.RightButton)
      compare(pastes.length, 3)
      mouseClick(data.editor, 20, 20, Qt.LeftButton)
      keyClick(Qt.Key_A, Qt.ControlModifier)
      compare(data.editor.selectedText, "fixture")
    }
  }
}
