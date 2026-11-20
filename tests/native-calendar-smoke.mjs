// Isolated native smoke test. Requires a Wayland compositor and installed Omarchy UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const runtime=process.env.JARVIS_NATIVE_WAYLAND_RUNTIME;
if(!runtime)throw new Error('Set JARVIS_NATIVE_WAYLAND_RUNTIME to a test-accessible Wayland runtime.');
const root=path.resolve(import.meta.dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-native-calendar-'));
const home=path.join(dir,'home');
fs.mkdirSync(path.join(home,'.local/bin'),{recursive:true});
for(const name of ['Commons','Ui'])fs.symlinkSync('/usr/share/omarchy/shell/'+name,path.join(dir,name));
for(const [source,target] of [['BarWidget.qml','JarvisWidget.qml'],['Panel.qml','Panel.qml'],['NotificationInbox.qml','NotificationInbox.qml']])fs.copyFileSync(path.join(root,'plugin/h3man.jarvis',source),path.join(dir,target));
const fixtureShell="import QtQuick\nimport QtQuick.Window\nimport Quickshell\nimport Quickshell.Io\nimport qs.Commons as Commons\nShellRoot {\n  Window {\n    visible: true; width: 100; height: 80\n    JarvisWidget { id: widget; anchors.centerIn: parent; animate: false }\n    Process { id: fail; command: [\"touch\", \"/tmp/jarvis-calendar-preview/offline\"] }\n    Process { id: recover; command: [\"rm\", \"-f\", \"/tmp/jarvis-calendar-preview/offline\"] }\n    Timer { interval: 600; running: true; onTriggered: widget.grabToImage(function(r) { r.saveToFile(\"/tmp/jarvis-calendar-preview/badge.png\") }) }\n    Timer { interval: 1200; running: true; onTriggered: {\n      if (!widget.panelItem || widget.calendarUnread !== 2) throw new Error(\"Missing panel or unread snapshot\")\n      widget.togglePanel()\n      console.log(\"CHECK: opened\", widget.opened)\n    } }\n    Timer { interval: 2200; running: true; onTriggered: {\n      widget.close()\n      widget.togglePanel()\n      widget.panelItem.notificationAction(\"notificationRead\",\"a\",0)\n    } }\n    Timer { interval: 3200; running: true; onTriggered: {\n      if (widget.calendarUnread !== 1) throw new Error(\"Read did not synchronize\")\n      widget.panelItem.notificationAction(\"notificationDismiss\",\"b\",0)\n    } }\n    Timer { interval: 4200; running: true; onTriggered: {\n      if (widget.calendarUnread !== 0) throw new Error(\"Dismiss did not synchronize\")\n      widget.close()\n      console.log(\"PASS: native panel loading, repeated open/close and shared actions\")\n      fail.running = true\n    } }\n    Timer { interval: 4700; running: true; onTriggered: widget.refreshNotifications() }\n    Timer { interval: 5300; running: true; onTriggered: {\n      if (widget.calendarAvailable || widget.calendarItems.length !== 1) throw new Error(\"Offline discarded saved snapshot\")\n      recover.running = true\n      Commons.Color.accent = \"#ff8800\"\n    } }\n    Timer { interval: 5900; running: true; onTriggered: widget.refreshNotifications() }\n    Timer { interval: 6500; running: true; onTriggered: {\n      if (!widget.calendarAvailable || widget.calendarUnread !== 2) throw new Error(\"Reconnect failed\")\n      widget.grabToImage(function(r) { r.saveToFile(\"/tmp/jarvis-calendar-preview/badge-theme.png\"); console.log(\"PASS: retained offline state, reconnect and theme change with animation disabled\"); Qt.quit() })\n    } }\n  }\n}\n";
const fixtureCLI="#!/usr/bin/env python3\nimport json,sys,os\nitems=[dict(id='a',title='Calendar review',body='Starts 12 Nov 2026, 17:00 (Europe/Bratislava)',read=False),dict(id='b',title='Team meeting',body='Starts 12 Nov 2026, 18:00 (Europe/Bratislava)',read=False)]\ndef out(event,**data): print(json.dumps(dict(event=event,**data)),flush=True)\ncmd=sys.argv[1]\nif cmd=='notifications':\n if os.path.exists('/tmp/jarvis-calendar-preview/offline'):out('notificationError',error='Offline');sys.exit(1)\n out('notifications',items=items,unread=2)\nelif cmd=='status':print(json.dumps(dict(running=True,agent=dict(label='Test agent'))))\nelif cmd=='setup-status':print('{\"configured\":true,\"voiceReady\":true}')\nelif cmd=='desktop':\n out('ready')\n for line in sys.stdin:\n  d=json.loads(line);a=d['action']\n  if a=='history':out('history',messages=[],busy=False)\n  elif a=='models':out('models',models=[])\n  elif a.startswith('notification'):\n   for n in items:\n    if n['id']==d.get('id'):\n     if a=='notificationRead':n['read']=True\n     if a in ['notificationDismiss','notificationSnooze']:items=[i for i in items if i['id']!=n['id']]\n   out('notifications',items=items,unread=sum(not i['read'] for i in items))\n";
fs.writeFileSync(path.join(dir,'shell.qml'),fixtureShell.replaceAll('/tmp/jarvis-calendar-preview',dir));
fs.writeFileSync(path.join(home,'.local/bin/jarvis'),fixtureCLI.replaceAll('/tmp/jarvis-calendar-preview',dir),{mode:0o700});
const child=spawn('quickshell',['-p',dir],{env:{...process.env,HOME:home,XDG_RUNTIME_DIR:runtime,QT_QPA_PLATFORM:'wayland'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const timeout=setTimeout(()=>child.kill('SIGTERM'),15000);
try {
 const [code]=await once(child,'exit');
 assert.equal(code,0,output);
 assert.match(output,/PASS: native panel loading/);
 assert.match(output,/PASS: retained offline state/);
 assert.doesNotMatch(output,/TypeError|ReferenceError|Missing panel|Read did not|Dismiss did not|Reconnect failed|Offline discarded/);
 console.log('PASS: native Wayland panel, count, actions, repeated lifecycle, offline recovery, theme and disabled animation.');
} finally {clearTimeout(timeout);fs.rmSync(dir,{recursive:true,force:true});}
