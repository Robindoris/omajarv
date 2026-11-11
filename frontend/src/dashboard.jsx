import {installSidebarGestures} from './sidebar-gestures';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {PanelLeft,Plus,ArrowUpRight,Trash2,X,Columns3,MessageSquare,Settings} from 'lucide-react';
import {Button} from './components/ui/button';
import {CalendarPage,NotificationInbox} from './calendar';
import {CalendarDays,Bell} from 'lucide-react';
import {KanbanBoard} from './kanban-board';
import {AgentModelPicker} from './agent-model-picker';
import {VoiceSettings} from './voice-settings';
function Dashboard(){
 useEffect(installSidebarGestures,[]);
 const [unread,setUnread]=useState(0);
 const [chats,setChats]=useState([]),[selected,setSelected]=useState(null),[page,setPage]=useState('conversation');
 async function load(){try{const history=await window.jarvisAPI('/api/conversations');setChats(history.conversations||[]);}catch{}}
 useEffect(()=>{const route=e=>setPage(e.detail);window.addEventListener('jarvis-workspace',route);load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},5000);return()=>{clearInterval(timer);window.removeEventListener('jarvis-workspace',route);};},[]);
 async function openChat(chat){
  try {setSelected(await window.jarvisAPI('/api/conversations?id='+encodeURIComponent(chat.id)));window.jarvisWorkspace('archive');}catch(e){window.alert(e.message);}
 }
 return <>
  {createPortal(<AgentModelPicker/>,document.getElementById('agent-model-picker'))}
  <Button variant="outline" size="icon" aria-label="Toggle sidebar" className="sidebar-trigger" onClick={()=>{document.body.dataset.sidebar=document.body.dataset.sidebar==='open'?'closed':'open';}}><PanelLeft size={18}/></Button>
  {createPortal(<><Button variant="ghost" className="sidebar-close" aria-label="Close sidebar" onClick={()=>{document.body.dataset.sidebar='closed';}}><X size={16}/>Close</Button><Button variant="ghost" className="sidebar-nav-button" aria-current={page==='calendar'?'page':undefined} onClick={()=>window.jarvisWorkspace('calendar')}><CalendarDays size={16}/>Calendar</Button><Button variant="ghost" className="sidebar-nav-button" aria-current={page==='notifications'?'page':undefined} onClick={()=>window.jarvisWorkspace('notifications')}><Bell size={16}/>Notifications {unread>0&&<span className="notification-count">{unread}</span>}</Button><Button variant="ghost" className="sidebar-nav-button" aria-current={page==='kanban'?'page':undefined} onClick={()=>window.jarvisWorkspace('kanban')}><Columns3 size={16}/>Kanban</Button><Button variant="ghost" className="sidebar-nav-button" aria-current={page==='settings'?'page':undefined} onClick={()=>window.jarvisWorkspace('settings')}><Settings size={16}/>Settings</Button></>,document.getElementById('sidebar-extra'))}
  {createPortal(<VoiceSettings active={page==='settings'}/>,document.getElementById('settings-panel'))}
  {createPortal(<><div className="chat-list-heading">CONVERSATIONS</div><Button variant="outline" className="new-chat-button" onClick={()=>{document.getElementById('chatView').click();document.getElementById('resetBtn').click();}}><Plus size={14}/>New conversation</Button><div className="saved-chat-list">{chats.map(chat=><button key={chat.id} className="saved-chat" onClick={()=>chat.active&&chat.agent===document.body.dataset.agent?document.getElementById('chatView').click():openChat(chat)}><MessageSquare size={14}/><span>{chat.title}<small>{chat.agent} · {new Date(chat.at).toLocaleDateString()} · {chat.count} messages</small></span></button>)}{!chats.length&&<p className="empty-chats">Your saved chats will appear here.</p>}</div></>,document.getElementById('conversation-list'))}
  {createPortal(<CalendarPage active={page==='calendar'}/>,document.getElementById('calendar-panel'))}
  {createPortal(<NotificationInbox active={page==='notifications'} onCount={setUnread}/>,document.getElementById('notifications-panel'))}
  {createPortal(<KanbanBoard active={page==='kanban'}/>,document.getElementById('kanban-panel'))}
  {createPortal(selected&&<div className="saved-conversation"><div className="archive-heading"><div><span className="eyebrow">SAVED CONVERSATION / {selected.agent}</span><h2>{selected.title}</h2></div><Button variant="outline" onClick={()=>document.getElementById('chatView').click()}>Current conversation</Button></div><div className="archive-messages">{selected.messages.map((m,i)=><article key={i} className={'archive-message '+m.role}><span>{m.role}</span><p>{m.text}</p></article>)}</div></div>,document.getElementById('archive-panel'))}
 </>;

}

import './reactor.js';
createRoot(document.getElementById('dashboard-nav')).render(<Dashboard/>);
