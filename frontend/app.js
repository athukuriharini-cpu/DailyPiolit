/* ==========================================================================
   DailyPilot — Frontend Application Logic
   Firebase Auth, Firestore real-time sync, full CRUD & scheduler control
   ========================================================================== */

const API_BASE = '';

// Local state
let state = {
  tasks: [],
  bills: [],
  alerts: [],
  briefing: null,
  scheduler: null,
  agentStatus: null,
  currentUser: null,
  firebaseInitialized: false,
};

let db = null;
let auth = null;
let pollTimer = null;

// ── Bootstrapping ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await initFirebase();
  await loadAllData();
  startStatusPolling();
});

// ── Firebase Initialization (Discovered via Firebase MCP) ───────────────────
async function initFirebase() {
  try {
    const configRes = await fetch('/api/firebase-config');
    const firebaseConfig = await configRes.json();

    if (window.firebase && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      state.firebaseInitialized = true;

      auth.onAuthStateChanged((user) => {
        state.currentUser = user;
        updateUserUI(user);
        if (user) {
          syncFirestoreToBackend(user);
        }
      });

      console.log('[Firebase] Initialized with project:', firebaseConfig.projectId);
    }
  } catch (err) {
    console.warn('[Firebase] Client initialization notice:', err);
  }
}

function updateUserUI(user) {
  const nameEl = document.getElementById('userDisplayName');
  const dotEl = document.getElementById('cloudSyncDot');
  const loggedInView = document.getElementById('authLoggedInView');
  const loggedOutView = document.getElementById('authLoggedOutView');

  if (user) {
    const display = user.email || (user.isAnonymous ? 'Guest User' : 'Authenticated');
    nameEl.textContent = display.split('@')[0];
    dotEl.style.background = '#10b981';
    dotEl.title = 'Firestore Live Sync: ' + display;

    document.getElementById('userCardEmail').textContent = display;
    document.getElementById('userCardUid').textContent = 'UID: ' + user.uid;
    document.getElementById('userAvatar').textContent = display.charAt(0).toUpperCase();

    loggedInView.style.display = 'block';
    loggedOutView.style.display = 'none';
  } else {
    nameEl.textContent = 'Sign In / Firebase';
    dotEl.style.background = '#94a3b8';
    dotEl.title = 'Offline / Local SQLite mode';

    loggedInView.style.display = 'none';
    loggedOutView.style.display = 'block';
  }
}

// ── Sync user items to Firestore ─────────────────────────────────────────────
async function syncItemToFirestore(collectionName, item) {
  if (!state.currentUser || !db) return;
  try {
    const userDocRef = db.collection('users').doc(state.currentUser.uid);
    await userDocRef.collection(collectionName).doc(String(item.id)).set({
      ...item,
      updated_at: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.warn('[Firestore] Sync item error:', err);
  }
}

async function deleteItemFromFirestore(collectionName, itemId) {
  if (!state.currentUser || !db) return;
  try {
    const userDocRef = db.collection('users').doc(state.currentUser.uid);
    await userDocRef.collection(collectionName).doc(String(itemId)).delete();
  } catch (err) {
    console.warn('[Firestore] Delete item error:', err);
  }
}

async function syncFirestoreToBackend(user) {
  // If user has items in Firestore, we can reflect them
  try {
    const snapshot = await db.collection('users').doc(user.uid).collection('tasks').get();
    if (!snapshot.empty) {
      console.log(`[Firestore] Found ${snapshot.size} cloud tasks for user.`);
    }
  } catch (e) {
    console.log('[Firestore] Ready for write operations.');
  }
}

// ── Data Fetching ────────────────────────────────────────────────────────────
async function loadAllData() {
  await Promise.allSettled([
    loadTasks(),
    loadBills(),
    loadAlerts(),
    loadBriefing(),
    checkAgentStatus(),
    loadSchedulerInfo(),
  ]);
  updateKPIs();
}

async function loadTasks() {
  try {
    const filter = document.getElementById('taskFilter').value;
    const url = filter === 'all' ? '/api/tasks' : `/api/tasks?status=${filter}`;
    const res = await fetch(url);
    state.tasks = await res.json();
    renderTasks();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

async function loadBills() {
  try {
    const filter = document.getElementById('billFilter').value;
    const url = filter === 'all' ? '/api/bills' : `/api/bills?status=${filter}`;
    const res = await fetch(url);
    state.bills = await res.json();
    renderBills();
  } catch (err) {
    console.error('Failed to load bills:', err);
  }
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts');
    state.alerts = await res.json();
    renderAlerts();
  } catch (err) {
    console.error('Failed to load alerts:', err);
  }
}

async function loadBriefing() {
  const container = document.getElementById('briefingContent');
  try {
    const res = await fetch('/api/briefing');
    if (!res.ok) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">☕</div>
          <p>No briefing generated yet.<br/><span class="text-dim">Click <strong>"Run Agent Now"</strong> to trigger DailyPilot.</span></p>
        </div>`;
      return;
    }
    const data = await res.json();
    state.briefing = data;
    container.innerHTML = renderMarkdown(data.content);
    if (data.created_at) {
      document.getElementById('briefingDateBadge').textContent = formatDateTime(data.created_at);
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <p>No briefing generated yet.<br/><span class="text-dim">Click <strong>"Run Agent Now"</strong> to trigger DailyPilot.</span></p>
      </div>`;
  }
}

async function loadSchedulerInfo() {
  try {
    const res = await fetch('/api/scheduler');
    const sched = await res.json();
    state.scheduler = sched;
    updateSchedulerUI(sched);
  } catch (e) {
    console.warn('Failed to fetch scheduler info:', e);
  }
}

// ── Rendering Functions ──────────────────────────────────────────────────────
function renderTasks() {
  const container = document.getElementById('tasksContainer');
  const countBadge = document.getElementById('tasksCountBadge');
  const items = state.tasks || [];

  countBadge.textContent = items.length;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No tasks found.<br/><span class="text-dim">Click <strong>+ Add Task</strong> above to add your first task.</span></p>
      </div>`;
    return;
  }

  container.innerHTML = items.map((t) => {
    const days = daysUntil(t.due_date);
    let dueBadge = '';
    if (days !== null) {
      if (days < 0) dueBadge = `<span class="luminous-badge badge-rose">${Math.abs(days)}d Overdue</span>`;
      else if (days === 0) dueBadge = `<span class="luminous-badge badge-amber">Due Today</span>`;
      else if (days <= 3) dueBadge = `<span class="luminous-badge badge-amber">In ${days}d</span>`;
      else dueBadge = `<span class="luminous-badge badge-cyan">In ${days}d</span>`;
    }

    const priorityBadge = `<span class="luminous-badge badge-${priorityColor(t.priority)}">${t.priority}</span>`;
    const categoryIcon = getCategoryIcon(t.category);

    return `
      <div class="interactive-item">
        <div class="item-icon-bubble">${categoryIcon}</div>
        <div class="item-main">
          <div class="item-title-row">
            <span class="item-title">${escapeHTML(t.title)}</span>
            ${priorityBadge}
            ${dueBadge}
          </div>
          <div class="item-sub-meta">
            <span>${escapeHTML(t.category)}</span>
            <span>·</span>
            <span>Status: <strong>${t.status}</strong></span>
            ${t.notes ? `<span>·</span><span>${escapeHTML(t.notes)}</span>` : ''}
          </div>
        </div>
        <div class="item-actions-cluster">
          <button class="action-icon-btn" title="Toggle status" onclick="toggleTaskStatus(${t.id}, '${t.status}')">
            ${t.status === 'done' ? '↩️' : '✅'}
          </button>
          <button class="action-icon-btn" title="Edit Task" onclick="openEditTaskModal(${t.id})">
            ✏️
          </button>
          <button class="action-icon-btn delete" title="Delete Task" onclick="deleteTask(${t.id})">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderBills() {
  const container = document.getElementById('billsContainer');
  const countBadge = document.getElementById('billsCountBadge');
  const items = state.bills || [];

  countBadge.textContent = items.length;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💳</div>
        <p>No bills registered.<br/><span class="text-dim">Click <strong>+ Add Bill</strong> to register a bill.</span></p>
      </div>`;
    return;
  }

  container.innerHTML = items.map((b) => {
    const days = daysUntil(b.due_date);
    let dueBadge = '';
    if (days !== null) {
      if (days < 0) dueBadge = `<span class="luminous-badge badge-rose">${Math.abs(days)}d Overdue</span>`;
      else if (days === 0) dueBadge = `<span class="luminous-badge badge-amber">Due Today</span>`;
      else if (days <= 5) dueBadge = `<span class="luminous-badge badge-amber">Due in ${days}d</span>`;
      else dueBadge = `<span class="luminous-badge badge-emerald">Due in ${days}d</span>`;
    }

    const recurringTag = b.is_recurring ? '<span class="luminous-badge badge-indigo" title="Recurring">↻ Auto</span>' : '';
    const amountColor = b.amount > 250 ? 'text-rose' : 'text-main';

    return `
      <div class="interactive-item">
        <div class="item-icon-bubble">💳</div>
        <div class="item-main">
          <div class="item-title-row">
            <span class="item-title">${escapeHTML(b.name)}</span>
            <span style="font-weight: 800; font-size: 0.95rem;" class="${amountColor}">$${Number(b.amount).toFixed(2)}</span>
            ${dueBadge}
            ${recurringTag}
          </div>
          <div class="item-sub-meta">
            <span>${escapeHTML(b.category)}</span>
            <span>·</span>
            <span>Status: <strong>${b.status}</strong></span>
            ${b.notes ? `<span>·</span><span>${escapeHTML(b.notes)}</span>` : ''}
          </div>
        </div>
        <div class="item-actions-cluster">
          <button class="action-icon-btn" title="Mark Paid" onclick="toggleBillStatus(${b.id}, '${b.status}')">
            ${b.status === 'paid' ? '↩️' : '💵'}
          </button>
          <button class="action-icon-btn" title="Edit Bill" onclick="openEditBillModal(${b.id})">
            ✏️
          </button>
          <button class="action-icon-btn delete" title="Delete Bill" onclick="deleteBill(${b.id})">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderAlerts() {
  const container = document.getElementById('alertsContainer');
  const countBadge = document.getElementById('alertsCountBadge');
  const openAlerts = (state.alerts || []).filter((a) => !a.resolved);

  countBadge.textContent = openAlerts.length;

  if (!openAlerts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <p><strong>All clear!</strong> No items currently require human judgment.</p>
      </div>`;
    return;
  }

  container.innerHTML = openAlerts.map((a) => {
    const sev = a.severity || 'medium';
    const badgeColor = sev === 'critical' || sev === 'high' ? 'rose' : 'amber';
    const descLines = (a.description || '').split('\n').filter(Boolean);
    const mainDesc = descLines[0] || '';
    const recAction = descLines.find(l => l.includes('Recommended action:')) || '';

    return `
      <div class="interactive-item" style="border-left: 3px solid var(--glow-${badgeColor});">
        <div class="item-icon-bubble">🚨</div>
        <div class="item-main">
          <div class="item-title-row">
            <span class="item-title">${escapeHTML(a.title)}</span>
            <span class="luminous-badge badge-${badgeColor}">${sev.toUpperCase()}</span>
          </div>
          <div class="item-sub-meta" style="flex-direction: column; align-items: flex-start; gap: 4px;">
            <p>${escapeHTML(mainDesc)}</p>
            ${recAction ? `<p style="color: var(--glow-indigo); font-weight: 600;">${escapeHTML(recAction)}</p>` : ''}
          </div>
        </div>
        <div class="item-actions-cluster">
          <button class="btn btn-xs btn-outline" onclick="resolveAlert(${a.id})">
            Resolve
          </button>
          <button class="action-icon-btn delete" title="Dismiss Alert" onclick="deleteAlert(${a.id})">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function updateKPIs() {
  const pendingTasks = (state.tasks || []).filter(t => t.status === 'pending').length;
  const pendingBills = (state.bills || []).filter(b => b.status === 'pending');
  const totalDue = pendingBills.reduce((acc, b) => acc + Number(b.amount || 0), 0);
  const openAlerts = (state.alerts || []).filter(a => !a.resolved).length;

  document.getElementById('kpiTasks').textContent = pendingTasks;
  document.getElementById('kpiBills').textContent = pendingBills.length;
  document.getElementById('kpiAlerts').textContent = openAlerts;
  document.getElementById('kpiTotal').textContent = '$' + totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Agent Execution & Polling ────────────────────────────────────────────────
async function triggerAgentRun() {
  const btn = document.getElementById('runAgentBtn');
  const label = document.getElementById('runBtnLabel');
  const banner = document.getElementById('activeRunBanner');

  btn.disabled = true;
  label.textContent = 'Agent Executing...';
  banner.style.display = 'flex';

  try {
    const res = await fetch('/api/run-agent', { method: 'POST' });
    const data = await res.json();
    console.log('[Agent] Run response:', data);
  } catch (err) {
    alert('Agent trigger error: ' + err.message);
  }
}

function startStatusPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(checkAgentStatus, 3000);
}

async function checkAgentStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.agentStatus = data.agent_status || {};

    const pulse = document.getElementById('agentPulse');
    const text = document.getElementById('agentStatusText');
    const btn = document.getElementById('runAgentBtn');
    const label = document.getElementById('runBtnLabel');
    const banner = document.getElementById('activeRunBanner');

    const status = state.agentStatus.status;

    if (status === 'running') {
      pulse.className = 'pulse-ring running';
      text.textContent = 'Agent Performing Autonomous Sweep...';
      btn.disabled = true;
      label.textContent = 'Sweeping Tasks & Bills...';
      banner.style.display = 'flex';
      btn._wasRunning = true;
    } else {
      pulse.className = 'pulse-ring';
      text.textContent = 'Agent Idle · Background Ready';
      btn.disabled = false;
      label.textContent = 'Run Agent Now';
      banner.style.display = 'none';

      if (btn._wasRunning) {
        btn._wasRunning = false;
        await loadAllData();
      }
    }
  } catch (err) {
    console.warn('Status poll error:', err);
  }
}

// ── Scheduler Controls ───────────────────────────────────────────────────────
function updateSchedulerUI(sched) {
  if (!sched) return;
  const statusEl = document.getElementById('schedActiveStatus');
  const nextEl = document.getElementById('schedNextRun');
  const selectEl = document.getElementById('schedIntervalSelect');
  const pauseBtn = document.getElementById('pauseResumeBtn');

  const mins = Math.round(sched.interval_seconds / 60);
  selectEl.value = String(sched.interval_seconds);

  if (sched.is_paused) {
    statusEl.textContent = 'Paused';
    statusEl.style.color = 'var(--glow-rose)';
    pauseBtn.textContent = '▶️ Resume Scheduler';
    nextEl.textContent = 'Next run: schedule currently paused';
  } else {
    statusEl.textContent = `Active · Running every ${mins} minute(s)`;
    statusEl.style.color = 'var(--glow-indigo)';
    pauseBtn.textContent = '⏸️ Pause Scheduler';
    nextEl.textContent = sched.next_run_time ? `Next run: ${formatDateTime(sched.next_run_time)}` : 'Next run scheduled';
  }
}

async function changeScheduleInterval(seconds) {
  try {
    const res = await fetch('/api/scheduler/interval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval_seconds: parseInt(seconds, 10) }),
    });
    const sched = await res.json();
    state.scheduler = sched;
    updateSchedulerUI(sched);
  } catch (err) {
    alert('Failed to update interval: ' + err.message);
  }
}

async function toggleSchedulePause() {
  if (!state.scheduler) return;
  const action = state.scheduler.is_paused ? 'resume' : 'pause';
  try {
    const res = await fetch(`/api/scheduler/${action}`, { method: 'POST' });
    const sched = await res.json();
    state.scheduler = sched;
    updateSchedulerUI(sched);
  } catch (err) {
    alert('Failed to toggle schedule: ' + err.message);
  }
}

// ── CRUD: Tasks ──────────────────────────────────────────────────────────────
function openAddTaskModal() {
  document.getElementById('taskFormId').value = '';
  document.getElementById('taskModalTitle').textContent = 'Add New Task';
  document.getElementById('taskFormTitle').value = '';
  document.getElementById('taskFormCategory').value = 'general';
  document.getElementById('taskFormPriority').value = 'medium';
  document.getElementById('taskFormDueDate').value = '';
  document.getElementById('taskFormStatus').value = 'pending';
  document.getElementById('taskFormNotes').value = '';
  openModal('taskModal');
}

function openEditTaskModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  document.getElementById('taskFormId').value = task.id;
  document.getElementById('taskModalTitle').textContent = 'Edit Task';
  document.getElementById('taskFormTitle').value = task.title;
  document.getElementById('taskFormCategory').value = task.category;
  document.getElementById('taskFormPriority').value = task.priority;
  document.getElementById('taskFormDueDate').value = task.due_date || '';
  document.getElementById('taskFormStatus').value = task.status;
  document.getElementById('taskFormNotes').value = task.notes || '';
  openModal('taskModal');
}

async function saveTaskSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('taskFormId').value;
  const payload = {
    title: document.getElementById('taskFormTitle').value.trim(),
    category: document.getElementById('taskFormCategory').value,
    priority: document.getElementById('taskFormPriority').value,
    due_date: document.getElementById('taskFormDueDate').value || null,
    status: document.getElementById('taskFormStatus').value,
    notes: document.getElementById('taskFormNotes').value.trim(),
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      syncItemToFirestore('tasks', { id: parseInt(id), ...payload });
    } else {
      res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      syncItemToFirestore('tasks', created);
    }

    closeModal('taskModal');
    await loadTasks();
    updateKPIs();
  } catch (err) {
    alert('Save task failed: ' + err.message);
  }
}

async function toggleTaskStatus(id, currentStatus) {
  const nextStatus = currentStatus === 'done' ? 'pending' : 'done';
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  try {
    await fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...task, status: nextStatus }),
    });
    syncItemToFirestore('tasks', { ...task, status: nextStatus });
    await loadTasks();
    updateKPIs();
  } catch (err) {
    alert('Update status error: ' + err.message);
  }
}

async function deleteTask(id) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    deleteItemFromFirestore('tasks', id);
    await loadTasks();
    updateKPIs();
  } catch (err) {
    alert('Delete task failed: ' + err.message);
  }
}

// ── CRUD: Bills ──────────────────────────────────────────────────────────────
function openAddBillModal() {
  document.getElementById('billFormId').value = '';
  document.getElementById('billModalTitle').textContent = 'Add New Bill';
  document.getElementById('billFormName').value = '';
  document.getElementById('billFormAmount').value = '';
  document.getElementById('billFormDueDate').value = '';
  document.getElementById('billFormCategory').value = 'utilities';
  document.getElementById('billFormStatus').value = 'pending';
  document.getElementById('billFormRecurring').checked = true;
  document.getElementById('billFormNotes').value = '';
  openModal('billModal');
}

function openEditBillModal(id) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;

  document.getElementById('billFormId').value = bill.id;
  document.getElementById('billModalTitle').textContent = 'Edit Bill';
  document.getElementById('billFormName').value = bill.name;
  document.getElementById('billFormAmount').value = bill.amount;
  document.getElementById('billFormDueDate').value = bill.due_date;
  document.getElementById('billFormCategory').value = bill.category;
  document.getElementById('billFormStatus').value = bill.status;
  document.getElementById('billFormRecurring').checked = Boolean(bill.is_recurring);
  document.getElementById('billFormNotes').value = bill.notes || '';
  openModal('billModal');
}

async function saveBillSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('billFormId').value;
  const payload = {
    name: document.getElementById('billFormName').value.trim(),
    amount: parseFloat(document.getElementById('billFormAmount').value),
    due_date: document.getElementById('billFormDueDate').value,
    category: document.getElementById('billFormCategory').value,
    status: document.getElementById('billFormStatus').value,
    is_recurring: document.getElementById('billFormRecurring').checked ? 1 : 0,
    notes: document.getElementById('billFormNotes').value.trim(),
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/bills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      syncItemToFirestore('bills', { id: parseInt(id), ...payload });
    } else {
      res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      syncItemToFirestore('bills', created);
    }

    closeModal('billModal');
    await loadBills();
    updateKPIs();
  } catch (err) {
    alert('Save bill failed: ' + err.message);
  }
}

async function toggleBillStatus(id, currentStatus) {
  const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid';
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;

  try {
    await fetch(`/api/bills/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bill, status: nextStatus }),
    });
    syncItemToFirestore('bills', { ...bill, status: nextStatus });
    await loadBills();
    updateKPIs();
  } catch (err) {
    alert('Update bill status error: ' + err.message);
  }
}

async function deleteBill(id) {
  if (!confirm('Delete this bill?')) return;
  try {
    await fetch(`/api/bills/${id}`, { method: 'DELETE' });
    deleteItemFromFirestore('bills', id);
    await loadBills();
    updateKPIs();
  } catch (err) {
    alert('Delete bill failed: ' + err.message);
  }
}

// ── CRUD: Alerts & Decisions ─────────────────────────────────────────────────
function openAddAlertModal() {
  document.getElementById('alertFormTitle').value = '';
  document.getElementById('alertFormSeverity').value = 'medium';
  document.getElementById('alertFormDesc').value = '';
  openModal('alertModal');
}

async function saveAlertSubmit(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('alertFormTitle').value.trim(),
    severity: document.getElementById('alertFormSeverity').value,
    description: document.getElementById('alertFormDesc').value.trim(),
    type: 'custom',
  };

  try {
    await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeModal('alertModal');
    await loadAlerts();
    updateKPIs();
  } catch (err) {
    alert('Create alert error: ' + err.message);
  }
}

async function resolveAlert(id) {
  try {
    await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' });
    await loadAlerts();
    updateKPIs();
  } catch (err) {
    alert('Resolve alert failed: ' + err.message);
  }
}

async function deleteAlert(id) {
  try {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
    await loadAlerts();
    updateKPIs();
  } catch (err) {
    alert('Delete alert failed: ' + err.message);
  }
}

// ── Workspace Wipe & Seed Controls ───────────────────────────────────────────
async function clearAllDataPrompt() {
  if (!confirm('This will wipe all tasks, bills, and alerts for a 100% clean personal start. Proceed?')) return;
  try {
    await fetch('/api/data/clear', { method: 'POST' });
    await loadAllData();
  } catch (err) {
    alert('Clear failed: ' + err.message);
  }
}

async function resetSampleDataPrompt() {
  if (!confirm('Reload realistic demo tasks and bills?')) return;
  try {
    await fetch('/api/data/reset', { method: 'POST' });
    await loadAllData();
  } catch (err) {
    alert('Reset failed: ' + err.message);
  }
}

// ── Firebase Auth Actions ───────────────────────────────────────────────────
function openAuthModal() {
  openModal('authModal');
}

function openScheduleModal() {
  openModal('scheduleModal');
}

async function handleEmailSignIn() {
  if (!auth) return alert('Firebase is still connecting...');
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  if (!email || !pass) return alert('Enter email and password');

  try {
    await auth.signInWithEmailAndPassword(email, pass);
    closeModal('authModal');
  } catch (err) {
    alert('Sign in failed: ' + err.message);
  }
}

async function handleEmailSignUp() {
  if (!auth) return alert('Firebase is still connecting...');
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  if (!email || !pass) return alert('Enter email and password');

  try {
    await auth.createUserWithEmailAndPassword(email, pass);
    closeModal('authModal');
  } catch (err) {
    alert('Sign up failed: ' + err.message);
  }
}

async function handleAnonymousSignIn() {
  if (!auth) return alert('Firebase is still connecting...');
  try {
    await auth.signInAnonymously();
    closeModal('authModal');
  } catch (err) {
    alert('Instant sign-in failed: ' + err.message);
  }
}

async function handleSignOut() {
  if (!auth) return;
  await auth.signOut();
}

// ── Modal Utilities ──────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ── Filter Triggers ──────────────────────────────────────────────────────────
function applyTaskFilter() {
  loadTasks();
}

function applyBillFilter() {
  loadBills();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) {
    return isoString;
  }
}

function getCategoryIcon(cat) {
  const icons = {
    health: '❤️',
    finance: '💰',
    home: '🏠',
    family: '👨‍👩‍👧',
    errands: '🛒',
    travel: '✈️',
    utilities: '⚡',
    general: '📌',
  };
  return icons[cat] || '📌';
}

function priorityColor(p) {
  const colors = {
    critical: 'rose',
    high: 'amber',
    medium: 'indigo',
    low: 'cyan',
  };
  return colors[p] || 'indigo';
}

function renderMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/^\| (.*) \|$/gim, (_, row) => {
      const cells = row.split(' | ').map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, m => `<table>${m}</table>`)
    .replace(/^---$/gim, '<hr/>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '<br/><br/>');
}
