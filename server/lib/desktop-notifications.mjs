// Native metadata operations are independent of chat/recording state.
// Serialize reads and writes so an older read cannot overwrite a mutation.
export function createDesktopNotifications(request, emit) {
  let serial = Promise.resolve();
  const commands = new Set(['notifications', 'notificationRead', 'notificationDismiss', 'notificationSnooze', 'notificationDetails']);
  async function snapshot() {
    const data = JSON.parse(await request('notifications'));
    const items = data.items.filter(item => item.source === 'calendar');
    emit('notifications', {items, unread:items.filter(item => !item.read).length});
  }
  return {
    handles: action => commands.has(action),
    dispatch(input) {
      const result = serial.then(async () => {
        try {
          if (input.action === 'notifications') return await snapshot();
          if (typeof input.id !== 'string' || !input.id || input.id.length > 100)
            throw new Error('invalid');
          if (input.action === 'notificationDetails') {
            const inbox = JSON.parse(await request('notifications'));
            const item = inbox.items.find(n => n.id === input.id && n.source === 'calendar');
            if (!item) throw new Error('missing');
            const calendar = JSON.parse(await request('calendar'));
            const event = calendar.events.find(e => e.id === item.targetId);
            if (!event) throw new Error('missing');
            emit('notificationDetails', {id:item.id, event:{
              id:event.id, title:event.title, notes:event.notes, timeZone:event.timeZone,
              startAt:item.when, endAt:item.when + event.endAt - event.startAt,
              recurrence:event.recurrence
            }});
            return;
          }
          // Check source server-side before allowing the calendar-only native UI
          // to mutate an arbitrary notification. Never retry uncertain writes.
          const inbox = JSON.parse(await request('notifications'));
          if (!inbox.items.some(n => n.id === input.id && n.source === 'calendar'))
            throw new Error('missing');
          const action = {notificationRead:'read', notificationDismiss:'dismiss', notificationSnooze:'snooze'}[input.action];
          if (!action) throw new Error('invalid');
          if (action === 'snooze' && ![5,15,60].includes(input.minutes)) throw new Error('invalid');
          await request('notifications', JSON.stringify({action:'notification:'+action,id:input.id,...(action === 'snooze' ? {minutes:input.minutes} : {})}));
          await snapshot();
        } catch {
          // Do not forward transport diagnostics, tokens, or server payloads.
          emit('notificationError', {error:'Calendar notifications unavailable. Refresh and try again.'});
        }
      });
      serial = result.catch(() => {});
      return result;
    }
  };
}
