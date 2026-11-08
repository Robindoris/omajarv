/* Kanban board - vanilla JS, no build step. */

const boardEl = document.getElementById('board');
const searchEl = document.getElementById('search');
const priorityFilter = document.getElementById('filter-priority');
const dueFilter = document.getElementById('filter-due');
const stateFilter = document.getElementById('filter-state');
const filterCount = document.getElementById('filter-count');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const sheet = document.getElementById('sheet');
const form = document.getElementById('sheet-form');
const fTitle = document.getElementById('f-title');
const fNotes = document.getElementById('f-notes');
const fCol = document.getElementById('f-col');
const fPriority = document.getElementById('f-priority');
const fRepeat = document.getElementById('f-repeat');
const fDue = document.getElementById('f-due');
const sheetIdEl = document.getElementById('sheet-id');
const sheetDelete = document.getElementById('sheet-delete');
const runPanel = document.getElementById('run-panel');
const runStateEl = document.getElementById('run-state');
const runMetaEl = document.getElementById('run-meta');
const runOutput = document.getElementById('run-output');
const runStart = document.getElementById('run-start');
const runStop = document.getElementById('run-stop');

const RUN_LABEL = {
  idle: 'not run',
  queued: 'queued',
  waiting: 'waiting for JARVIS…',
  running: 'running…',
  done: 'completed ✓',
  interrupted: 'interrupted',
  failed: 'failed',
  cancelled: 'stopped',
};

let board = { columns: [] };
let dragId = null;
let editingId = null;
let busy = false;
let pollTimer = null;
const pendingRuns = new Set();
let touchDrag = null; // finger drag in progress: { id, pointerId, card, startX, startY, started }
let suppressClick = false;

/* ------------------------------------------------------------------ utils */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

/* ------------------------------------------------------------------- data */

async function load({ quiet = false } = {}) {
  try {
    board = await api('/api/board');
    render();
    setStatus('synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (err) {
    setStatus('offline', true);
    if (!quiet) toast('Cannot reach the board: ' + err.message);
  }
}

async function createTask(fields) {
  try {
    const task = await api('/api/tasks', { method: 'POST', body: JSON.stringify(fields) });
    await load({ quiet: true });
    return task;
  } catch (err) {
    toast('Could not add task: ' + err.message);
    throw err;
  }
}

async function moveTask(id, col, index) {
  try {
    await api(`/api/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ col, index }),
    });
  } catch (err) {
    toast('Move failed: ' + err.message);
  }
  await load({ quiet: true });
}

/* --------------------------------------------------------------- agent run */

const isActive = (task) => ['queued', 'waiting', 'running'].includes(task.run_state);

async function startTask(id) {
  if (pendingRuns.has(id)) return;
  pendingRuns.add(id);
  render();
  if (editingId === id) runStart.disabled = true;
  try {
    await api(`/api/tasks/${id}/run`, { method: 'POST', body: '{}' });
    toast('Handed to the agent');
    await load({ quiet: true });
    if (sheet.open && editingId === id) refreshSheet();
  } catch (err) {
    toast('Could not start: ' + err.message);
  } finally {
    pendingRuns.delete(id);
    render();
    if (editingId === id) refreshSheet();
  }
}

async function stopTask(id) {
  try {
    await api(`/api/tasks/${id}/cancel`, { method: 'POST', body: '{}' });
    toast('Stopping…');
    await load({ quiet: true });
    if (sheet.open && editingId === id) refreshSheet();
  } catch (err) {
    toast('Could not stop: ' + err.message);
  }
}

/* ----------------------------------------------------------------- render */

function formatDue(due, done) {
  if (!due) return null;
  const today = localToday();
  // Parse the date at UTC noon and format in the board's time zone.
  const date = new Date(due + 'T12:00:00Z');
  const label = date.toLocaleDateString([], {
    timeZone: 'Europe/Bratislava', month: 'short', day: 'numeric', year: 'numeric',
  });
  if (!done && due < today) return { label: `Overdue · ${label}`, cls: 'overdue' };
  if (!done && due === today) return { label: 'Due today', cls: 'today' };
  return { label: `Due ${label}`, cls: '' };
}

function cardEl(task, colId) {
  const card = document.createElement('article');
  card.className = 'card p-' + (task.priority || 'normal');
  card.dataset.id = task.id;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `Task #${task.id}: ${task.title}`);
  card.setAttribute('aria-describedby', 'keyboard-help');
  card.draggable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (colId === 'done') card.classList.add('done');
  if (task.run_state && task.run_state !== 'idle') card.classList.add('run-' + task.run_state);

  const top = document.createElement('div');
  top.className = 'card-top';

  const title = document.createElement('h3');
  title.className = 'title';
  title.textContent = task.title;
  top.appendChild(title);

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'run-btn' + (isActive(task) ? ' busy' : '');
  runBtn.textContent = isActive(task) ? '■' : (['failed', 'interrupted', 'cancelled'].includes(task.run_state) ? '↻' : '▶');
  runBtn.disabled = pendingRuns.has(task.id);
  runBtn.title = isActive(task) ? 'Stop the agent' : (['failed', 'interrupted', 'cancelled'].includes(task.run_state) ? 'Retry task' : 'Run with the agent');
  runBtn.setAttribute('aria-label', runBtn.title);
  runBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (isActive(task)) stopTask(task.id);
    else startTask(task.id);
  });
  top.appendChild(runBtn);

  const adv = document.createElement('button');
  adv.className = 'advance';
  adv.type = 'button';
  adv.title = 'Move to next column';
  adv.setAttribute('aria-label', adv.title);
  adv.textContent = '›';
  adv.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const ids = board.columns.map((c) => c.id);
    const next = ids[ids.indexOf(colId) + 1];
    if (next) moveTask(task.id, next);
  });
  top.appendChild(adv);
  card.appendChild(top);

  if (task.notes) {
    const notes = document.createElement('p');
    notes.className = 'notes';
    notes.textContent = task.notes;
    card.appendChild(notes);
  }

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  if (task.due) {
    const due = formatDue(task.due, colId === 'done');
    const span = document.createElement('span');
    span.className = 'due ' + (due.cls || '');
    span.textContent = due.label;
    span.title = `Due ${task.due} (Europe/Bratislava)`;
    span.setAttribute('aria-label', due.label + ', ' + task.due + ', Bratislava time');
    meta.appendChild(span);
  }
  if (task.priority === 'high') {
    const p = document.createElement('span');
    p.textContent = 'high';
    p.style.color = 'var(--high)';
    meta.appendChild(p);
  }
  if (task.run_state && task.run_state !== 'idle') {
    const chip = document.createElement('span');
    chip.className = 'run-chip ' + task.run_state;
    chip.textContent = RUN_LABEL[task.run_state] || task.run_state;
    meta.appendChild(chip);
  }
  if (task.repeat && task.repeat !== 'none') {
    const repeat = document.createElement('span');
    repeat.className = 'run-chip';
    repeat.textContent = '↻ ' + task.repeat;
    meta.appendChild(repeat);
  }
  if (meta.childNodes.length) card.appendChild(meta);

  card.addEventListener('keydown', async (ev) => {
    if (ev.target !== card) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openSheet(task);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const columns = [...boardEl.querySelectorAll('section.column')];
    const column = card.closest('.column');
    const cards = [...column.querySelectorAll('.card')];
    const direction = ['ArrowUp', 'ArrowLeft'].includes(ev.key) ? -1 : 1;
    if (ev.altKey && ['ArrowLeft', 'ArrowRight'].includes(ev.key)) {
      const next = board.columns[columns.indexOf(column) + direction];
      if (next) {
        await moveTask(task.id, next.id);
        boardEl.querySelector(`.card[data-id="${task.id}"]`)?.focus();
        toast(`Moved to ${next.title}`);
      }
    } else if (['ArrowUp', 'ArrowDown'].includes(ev.key)) {
      cards[cards.indexOf(card) + direction]?.focus();
    } else {
      columns[columns.indexOf(column) + direction]?.querySelector('.card, .add-inline')?.focus();
    }
  });
  card.addEventListener('click', () => openSheet(task));
  return card;
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((p) => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function matchesFilters(task, today) {
  const q = searchEl.value.trim().toLowerCase();
  if (q && !(task.title + ' ' + (task.notes || '')).toLowerCase().includes(q)) return false;
  if (priorityFilter.value && (task.priority || 'normal') !== priorityFilter.value) return false;
  if (stateFilter.value && (task.run_state || 'idle') !== stateFilter.value) return false;
  const due = task.due;
  switch (dueFilter.value) {
    case 'none': return !due;
    case 'overdue': return !!due && due < today;
    case 'today': return due === today;
    case 'upcoming': return !!due && due > today;
    default: return true;
  }
}

function render() {
  const focused = boardEl.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = focused?.classList.contains('card') ? focused.dataset.id : null;
  const today = localToday();
  let shown = 0;
  const total = board.columns.reduce((sum, col) => sum + col.tasks.length, 0);
  const scroll = boardEl.scrollLeft;
  boardEl.innerHTML = '';

  for (const col of board.columns) {
    const tasks = col.tasks.filter((t) => matchesFilters(t, today));
    shown += tasks.length;

    const section = document.createElement('section');
    section.className = 'column';
    section.dataset.col = col.id;

    const head = document.createElement('header');
    head.className = 'col-head';

    const h2 = document.createElement('h2');
    h2.textContent = col.title;
    h2.title = 'Double-click or press Enter to rename';
    h2.tabIndex = 0;
    h2.setAttribute('aria-label', col.title + ', press Enter to rename column');
    const renameColumn = async () => {
      const next = prompt('Rename column', col.title);
      if (!next || next.trim() === col.title) return;
      try {
        await api(`/api/columns/${col.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: next.trim() }),
        });
        await load({ quiet: true });
      } catch (err) { toast(err.message); }
    };
    h2.addEventListener('dblclick', renameColumn);
    h2.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); renameColumn(); }
    });
    head.appendChild(h2);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(tasks.length);
    head.appendChild(count);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);

    const addBtn = document.createElement('button');
    addBtn.className = 'icon';
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = 'Add task';
    addBtn.setAttribute('aria-label', 'Add task to ' + col.title);
    addBtn.addEventListener('click', () => openComposer(section));
    head.appendChild(addBtn);

    section.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.dataset.col = col.id;
    for (const t of tasks) cards.appendChild(cardEl(t, col.id));
    section.appendChild(cards);

    const inline = document.createElement('button');
    inline.className = 'add-inline';
    inline.type = 'button';
    inline.textContent = '+ Add a task';
    inline.addEventListener('click', () => openComposer(section));
    section.appendChild(inline);

    boardEl.appendChild(section);
  }

  const addCol = document.createElement('button');
  addCol.className = 'column add-col';
  addCol.textContent = '+ New column';
  addCol.style.cssText = 'align-items:center;justify-content:center;color:var(--muted);background:transparent;border-style:dashed;cursor:pointer;min-height:110px;font:inherit';
  addCol.addEventListener('click', async () => {
    const name = prompt('New column name');
    if (!name || !name.trim()) return;
    try {
      await api('/api/columns', { method: 'POST', body: JSON.stringify({ title: name.trim() }) });
      await load({ quiet: true });
    } catch (err) { toast(err.message); }
  });
  boardEl.appendChild(addCol);

  filterCount.textContent = `${shown} of ${total} tasks` + (shown === 0 ? ' — no matching tasks' : '');
  boardEl.scrollLeft = scroll;
  if (focusedId) boardEl.querySelector(`.card[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
}

/* --------------------------------------------------------------- composer */

function openComposer(section) {
  if (section.querySelector('.composer')) {
    section.querySelector('.composer textarea').focus();
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'composer';
  const ta = document.createElement('textarea');
  ta.placeholder = 'Task title — Enter to save, Shift+Enter for a note';
  ta.rows = 2;
  wrap.appendChild(ta);
  section.querySelector('.add-inline').before(wrap);
  ta.focus();

  let closed = false;
  const close = () => { if (!closed) { closed = true; wrap.remove(); } };

  ta.addEventListener('keydown', async (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const title = ta.value.trim();
      if (!title) return close();
      closed = true;
      await createTask({ title, col: section.dataset.col });
      wrap.remove();
    }
  });
  ta.addEventListener('blur', () => {
    if (!ta.value.trim()) close();
  });
}

/* ------------------------------------------------------------------ sheet */

function openSheet(task = null) {
  editingId = task ? task.id : null;
  sheetIdEl.textContent = task ? '#' + task.id : 'new task';
  sheetDelete.style.display = task ? '' : 'none';
  fTitle.value = task ? task.title : '';
  fNotes.value = task ? task.notes || '' : '';
  fPriority.value = task ? task.priority : 'normal';
  fDue.value = task && task.due ? task.due : '';
  fRepeat.value = task?.repeat || 'none';

  fCol.innerHTML = '';
  for (const c of board.columns) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.title;
    fCol.appendChild(opt);
  }
  if (task) fCol.value = task.col;

  paintRunPanel(task);
  if (task) {
    api('/api/tasks/' + task.id)
      .then((full) => { if (editingId === task.id) paintRunPanel(full); })
      .catch(() => {});
  }

  sheet.showModal();
  fTitle.focus();
  fTitle.select();
}

function paintRunPanel(task) {
  if (!task) {
    runPanel.hidden = true;
    return;
  }
  runPanel.hidden = false;
  const state = task.run_state || 'idle';
  runStateEl.textContent = RUN_LABEL[state] || state;
  runStateEl.className = 'pill run-chip ' + state;
  const started = task.run_started_at ? new Date(task.run_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const finished = task.run_finished_at ? new Date(task.run_finished_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  runMetaEl.textContent = started ? (finished ? `${started}–${finished}` : `since ${started}`) : '';
  const active = isActive(task);
  runStart.hidden = active;
  runStart.disabled = pendingRuns.has(task.id);
  runStart.textContent = ['failed', 'interrupted', 'cancelled'].includes(state) ? '↻ Retry' : '▶ Run';
  runStop.hidden = !active;
  const detail = ['failed', 'interrupted'].includes(state) ? `Execution ${RUN_LABEL[state]}. ${task.run_exit != null ? 'Exit code: ' + task.run_exit + '. ' : ''}Review the details below, then Retry when ready.` : '';
  const output = [detail, task.run_output || ''].filter(Boolean).join('\n\n');
  runOutput.hidden = !output;
  runOutput.textContent = output;
}

async function refreshSheet() {
  if (!editingId) return;
  try {
    const full = await api('/api/tasks/' + editingId);
    if (editingId === full.id) paintRunPanel(full);
  } catch { /* ignore */ }
}

runStart.addEventListener('click', () => { if (editingId) startTask(editingId); });
runStop.addEventListener('click', () => { if (editingId) stopTask(editingId); });

function closeSheet() {
  editingId = null;
  if (sheet.open) sheet.close();
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (busy) return;
  const payload = {
    title: fTitle.value.trim(),
    notes: fNotes.value,
    col: fCol.value,
    priority: fPriority.value,
    due: fDue.value || null,
    repeat: fRepeat.value,
  };
  if (!payload.title) return;
  busy = true;
  try {
    if (editingId) {
      await api(`/api/tasks/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeSheet();
    await load({ quiet: true });
  } catch (err) {
    toast('Save failed: ' + err.message);
  } finally {
    busy = false;
  }
});

sheetDelete.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Delete this task?')) return;
  try {
    await api(`/api/tasks/${editingId}`, { method: 'DELETE' });
    closeSheet();
    await load({ quiet: true });
  } catch (err) { toast('Delete failed: ' + err.message); }
});

document.getElementById('sheet-close').addEventListener('click', closeSheet);
document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
document.getElementById('new-task').addEventListener('click', () => openSheet(null));
sheet.addEventListener('close', () => { editingId = null; });

/* --------------------------------------------------------------- drag/drop */

function afterElement(container, y) {
  const cards = [...container.querySelectorAll('.card:not(.dragging)')];
  let closest = null;
  let best = -Infinity;
  for (const el of cards) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > best) { best = offset; closest = el; }
  }
  return closest;
}

boardEl.addEventListener('dragstart', (ev) => {
  const card = ev.target.closest('.card');
  if (!card) return;
  dragId = card.dataset.id;
  card.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
});

boardEl.addEventListener('dragover', (ev) => {
  if (!dragId) return;
  const column = ev.target.closest('.column');
  if (!column) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  const cards = column.querySelector('.cards');
  const dragging = boardEl.querySelector('.card.dragging');
  if (!cards || !dragging) return;
  boardEl.querySelectorAll('.column').forEach((c) => c.classList.toggle('drop-ok', c === column));
  const after = afterElement(cards, ev.clientY);
  if (after === dragging) return;
  if (after == null) cards.appendChild(dragging);
  else cards.insertBefore(dragging, after);
});

boardEl.addEventListener('dragend', (ev) => {
  const card = ev.target.closest('.card');
  boardEl.querySelectorAll('.column.drop-ok').forEach((c) => c.classList.remove('drop-ok'));
  if (!card) { dragId = null; return; }
  card.classList.remove('dragging');
  const column = card.closest('.column');
  if (!dragId || !column) { dragId = null; return; }
  dragId = null;
  const index = [...column.querySelectorAll('.cards .card')].indexOf(card);
  moveTask(card.dataset.id, column.dataset.col, Math.max(index, 0));
});

/* Touch / finger dragging. HTML5 drag events only fire for fine pointers
   (mouse), so touch screens drive the same reorder through Pointer Events. */
const TOUCH_DRAG_THRESHOLD = 6;

function clearDropOk() {
  boardEl.querySelectorAll('.column.drop-ok').forEach((c) => c.classList.remove('drop-ok'));
}

function finishTouchDrag(commit) {
  const drag = touchDrag;
  touchDrag = null;
  clearDropOk();
  if (!drag) return;
  const card = drag.card;
  if (card) { card.classList.remove('dragging'); card.style.touchAction = ''; }
  if (!commit || !drag.started) return;
  const column = card.closest('.column');
  const cards = column ? column.querySelector('.cards') : null;
  if (!column || !cards) return;
  const index = [...cards.querySelectorAll('.card')].indexOf(card);
  moveTask(card.dataset.id, column.dataset.col, Math.max(index, 0));
}

boardEl.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType !== 'touch') return;
  if (touchDrag) return;
  const card = ev.target.closest('.card');
  if (!card) return;
  if (card.classList.contains('dragging')) return;
  const drag = { id: card.dataset.id, pointerId: ev.pointerId, card, startX: ev.clientX, startY: ev.clientY, started: false };
  card.classList.add('dragging');
  card.style.touchAction = 'none';
  try { boardEl.setPointerCapture(ev.pointerId); } catch { /* capture unsupported */ }
  touchDrag = drag;
});

function onTouchMove(ev) {
  const drag = touchDrag;
  if (!drag || drag.pointerId !== ev.pointerId) return;
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  if (!drag.started) {
    if (Math.abs(dx) < TOUCH_DRAG_THRESHOLD && Math.abs(dy) < TOUCH_DRAG_THRESHOLD) return;
    drag.started = true;
    suppressClick = true;
  }
  const column = drag.card.closest('.column');
  const cards = column ? column.querySelector('.cards') : null;
  if (!cards) return;
  boardEl.querySelectorAll('.column').forEach((c) => c.classList.toggle('drop-ok', c === column));
  const after = afterElement(cards, ev.clientY);
  if (after === drag.card) return;
  if (after == null) cards.appendChild(drag.card);
  else cards.insertBefore(drag.card, after);
}

function onTouchEnd(ev, cancelled) {
  if (touchDrag && touchDrag.pointerId !== ev.pointerId) return;
  finishTouchDrag(!cancelled);
}

boardEl.addEventListener('pointermove', onTouchMove);
boardEl.addEventListener('pointerup', (ev) => onTouchEnd(ev, false));
boardEl.addEventListener('pointercancel', (ev) => onTouchEnd(ev, true));

// Swallow the click that follows a completed touch drag so releasing a
// finger doesn't open the task sheet mid-drag.
document.addEventListener('click', (ev) => {
  if (!suppressClick) return;
  ev.preventDefault();
  ev.stopPropagation();
  suppressClick = false;
}, true);

/* -------------------------------------------------------------- lifecycle */

searchEl.addEventListener('input', () => render());
[priorityFilter, dueFilter, stateFilter].forEach((el) => el.addEventListener('change', render));
document.getElementById('clear-filters').addEventListener('click', () => {
  searchEl.value = '';
  [priorityFilter, dueFilter, stateFilter].forEach((el) => { el.value = ''; });
  render();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheet.open) closeSheet();
  if (ev.key === '/' && document.activeElement === document.body) {
    ev.preventDefault();
    searchEl.focus();
  }
});

function schedulePoll() {
  clearTimeout(pollTimer);
  const active = board.columns.some((c) => c.tasks.some(isActive));
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && !dragId && !touchDrag) {
      if (sheet.open) await refreshSheet();
      else await load({ quiet: true });
    }
    schedulePoll();
  }, active ? 2500 : 20000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !sheet.open) load({ quiet: true });
});

load();


/* Follow the server machine's active Omarchy palette, including phone clients. */
async function refreshTheme() {
  try {
    const theme = await api('/api/theme');
    const allowed = ['--bg', '--panel', '--text', '--muted', '--accent', '--high', '--ok', '--warning', '--accent-dim'];
    for (const key of allowed) {
      const value = theme.colors?.[key];
      if (/^#[0-9a-f]{6}$/i.test(value || '')) document.documentElement.style.setProperty(key, value);
      else document.documentElement.style.removeProperty(key);
    }
    document.documentElement.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  } catch { /* Retain the current palette while offline or during a restart. */ }
}
refreshTheme();
setInterval(() => { if (document.visibilityState === 'visible') refreshTheme(); }, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshTheme();
});
