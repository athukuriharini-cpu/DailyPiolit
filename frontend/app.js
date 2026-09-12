/* ==========================================================================
   DailyPilot — Frontend Application Logic (v2.0)
   Strict Authentication Gate + 100% Cloud Firestore Real-Time Storage
   Zero dummy/canned data. Only user-created items are tracked.
   ========================================================================== */

let state = {
  currentUser: null,
  tasks: [],
  bills: [],
  alerts: [],
  briefing: null,
  scheduler: null,
  unsubscribers: [],
};

let auth = null;
let db = null;

// ── Application Initialization ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await initFirebaseClient();
  loadSchedulerInfo();
});

async function initFirebaseClient() {
  try {
    const configRes = await fetch('/api/firebase-config');
    const firebaseConfig = await configRes.json();

    if (window.firebase && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();

      auth.onAuthStateChanged((user) => {
        state.currentUser = user;
        handleAuthGateState(user);
        if (user) {
          bindFirestoreListeners(user);
        } else {
          unbindFirestoreListeners();
        }
      });

      console.log('[Firebase] Connected to project:', firebaseConfig.projectId);
    }
  } catch (err) {
    console.error('[Firebase] Client initialization error:', err);
  }
}

// ── Authentication Gate Control ──────────────────────────────────────────────
function handleAuthGateState(user) {
  const gate = document.getElementById('authGateOverlay');
  const userPillName = document.getElementById('userDisplayName');
  const syncDot = document.getElementById('cloudSyncDot');

  if (user) {
    // Dismiss Gate
    gate.classList.add('hidden');
    const displayEmail = user.email || (user.isAnonymous ? 'Guest User' : 'Authenticated');
    userPillName.textContent = displayEmail;
    syncDot.style.background = '#10b981';
    syncDot.title = 'Cloud Firestore Live: ' + displayEmail;
  } else {
    // Show Gate & reset view
    gate.classList.remove('hidden');
    userPillName.textContent = 'Sign In';
    syncDot.style.background = '#94a3b8';
    syncDot.title = 'Authentication Required';
    state.tasks = [];
    state.bills = [];
    state.alerts = [];
    state.briefing = null;
    renderAll();
  }
}

// ── Cloud Firestore Real-Time Bindings ───────────────────────────────────────
function bindFirestoreListeners(user) {
  unbindFirestoreListeners();
  const userDoc = db.collection('users').doc(user.uid);

  // 1. Tasks Listener
  const unsubTasks = userDoc.collection('tasks').onSnapshot((snapshot) => {
    state.tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks();
    updateKPIs();
  }, (err) => console.warn('[Firestore] Tasks sync:', err));

  // 2. Bills Listener
  const unsubBills = userDoc.collection('bills').onSnapshot((snapshot) => {
    state.bills = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBills();
    updateKPIs();
  }, (err) => console.warn('[Firestore] Bills sync:', err));

  // 3. Alerts Listener
  const unsubAlerts = userDoc.collection('alerts').onSnapshot((snapshot) => {
    state.alerts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAlerts();
    updateKPIs();
  }, (err) => console.warn('[Firestore] Alerts sync:', err));

  // 4. Briefings Listener (Latest)
  const unsubBriefings = userDoc.collection('briefings')
    .orderBy('created_at', 'desc')
    .limit(1)
    .onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        state.briefing = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        renderBriefing();
      } else {
        state.briefing = null;
        renderBriefing();
      }
    }, (err) => console.warn('[Firestore] Briefing sync:', err));

  state.unsubscribers = [unsubTasks, unsubBills, unsubAlerts, unsubBriefings];
}

function unbindFirestoreListeners() {
  if (state.unsubscribers && state.unsubscribers.length) {
    state.unsubscribers.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    state.unsubscribers = [];
  }
}

// ── Render Views ─────────────────────────────────────────────────────────────
function renderAll() {
  renderTasks();
  renderBills();
  renderAlerts();
  renderBriefing();
  updateKPIs();
}

function renderTasks() {
  const container = document.getElementById('tasksContainer');
  const countBadge = document.getElementById('tasksCountBadge');
  const filter = document.getElementById('taskFilter').value;

  let items = state.tasks || [];
  if (filter !== 'all') {
    items = items.filter(t => t.status === filter);
  }

  countBadge.textContent = items.length;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p><strong>No tasks found.</strong><br/><span class="text-dim">Click <strong>+ Add Task</strong> to add your personal tasks.</span></p>
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
          <button class="action-icon-btn" title="Toggle status" onclick="toggleTaskStatus('${t.id}', '${t.status}')">
            ${t.status === 'done' ? '↩️' : '✅'}
          </button>
          <button class="action-icon-btn" title="Edit Task" onclick="openEditTaskModal('${t.id}')">
            ✏️
          </button>
          <button class="action-icon-btn delete" title="Delete Task" onclick="deleteTask('${t.id}')">
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
  const filter = document.getElementById('billFilter').value;

  let items = state.bills || [];
  if (filter !== 'all') {
    items = items.filter(b => b.status === filter);
  }

  countBadge.textContent = items.length;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💳</div>
        <p><strong>No bills found.</strong><br/><span class="text-dim">Click <strong>+ Add Bill</strong> to track your real expenses.</span></p>
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

    const recurringTag = b.is_recurring ? '<span class="luminous-badge badge-indigo">↻ Recurring</span>' : '';
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
          <button class="action-icon-btn" title="Mark Paid" onclick="toggleBillStatus('${b.id}', '${b.status}')">
            ${b.status === 'paid' ? '↩️' : '💵'}
          </button>
          <button class="action-icon-btn" title="Edit Bill" onclick="openEditBillModal('${b.id}')">
            ✏️
          </button>
          <button class="action-icon-btn delete" title="Delete Bill" onclick="deleteBill('${b.id}')">
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
          <button class="btn btn-xs btn-outline" onclick="resolveAlert('${a.id}')">
            Resolve
          </button>
          <button class="action-icon-btn delete" title="Dismiss Alert" onclick="deleteAlert('${a.id}')">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderBriefing() {
  const container = document.getElementById('briefingContent');
  const dateBadge = document.getElementById('briefingDateBadge');

  if (state.briefing && state.briefing.content) {
    container.innerHTML = renderMarkdown(state.briefing.content);
    if (state.briefing.created_at) {
      dateBadge.textContent = formatDateTime(state.briefing.created_at);
    }
  } else {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <p>Workspace is empty.<br/><span class="text-dim">Add your real tasks or bills and click <strong>"Run Agent Now"</strong> to generate your personal briefing.</span></p>
      </div>`;
    dateBadge.textContent = 'Today';
  }
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

// ── CRUD: Tasks (Direct Cloud Firestore) ──────────────────────────────────────
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
  if (!state.currentUser) return alert('Please sign in first.');

  const id = document.getElementById('taskFormId').value;
  const taskData = {
    title: document.getElementById('taskFormTitle').value.trim(),
    category: document.getElementById('taskFormCategory').value,
    priority: document.getElementById('taskFormPriority').value,
    due_date: document.getElementById('taskFormDueDate').value || null,
    status: document.getElementById('taskFormStatus').value,
    notes: document.getElementById('taskFormNotes').value.trim(),
    updated_at: new Date().toISOString(),
  };

  const tasksRef = db.collection('users').doc(state.currentUser.uid).collection('tasks');

  try {
    if (id) {
      await tasksRef.doc(id).update(taskData);
    } else {
      taskData.created_at = new Date().toISOString();
      await tasksRef.add(taskData);
    }
    closeModal('taskModal');
  } catch (err) {
    alert('Failed to save task to Firestore: ' + err.message);
  }
}

async function toggleTaskStatus(id, currentStatus) {
  if (!state.currentUser) return;
  const nextStatus = currentStatus === 'done' ? 'pending' : 'done';
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('tasks').doc(id).update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    alert('Update failed: ' + err.message);
  }
}

async function deleteTask(id) {
  if (!state.currentUser) return;
  if (!confirm('Delete this task?')) return;
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('tasks').doc(id).delete();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ── CRUD: Bills (Direct Cloud Firestore) ──────────────────────────────────────
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
  if (!state.currentUser) return alert('Please sign in first.');

  const id = document.getElementById('billFormId').value;
  const billData = {
    name: document.getElementById('billFormName').value.trim(),
    amount: parseFloat(document.getElementById('billFormAmount').value),
    due_date: document.getElementById('billFormDueDate').value,
    category: document.getElementById('billFormCategory').value,
    status: document.getElementById('billFormStatus').value,
    is_recurring: document.getElementById('billFormRecurring').checked ? 1 : 0,
    notes: document.getElementById('billFormNotes').value.trim(),
    updated_at: new Date().toISOString(),
  };

  const billsRef = db.collection('users').doc(state.currentUser.uid).collection('bills');

  try {
    if (id) {
      await billsRef.doc(id).update(billData);
    } else {
      billData.created_at = new Date().toISOString();
      await billsRef.add(billData);
    }
    closeModal('billModal');
  } catch (err) {
    alert('Failed to save bill to Firestore: ' + err.message);
  }
}

async function toggleBillStatus(id, currentStatus) {
  if (!state.currentUser) return;
  const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid';
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('bills').doc(id).update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    alert('Update failed: ' + err.message);
  }
}

async function deleteBill(id) {
  if (!state.currentUser) return;
  if (!confirm('Delete this bill?')) return;
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('bills').doc(id).delete();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ── CRUD: Alerts (Direct Cloud Firestore) ────────────────────────────────────
function openAddAlertModal() {
  document.getElementById('alertFormTitle').value = '';
  document.getElementById('alertFormSeverity').value = 'medium';
  document.getElementById('alertFormDesc').value = '';
  openModal('alertModal');
}

async function saveAlertSubmit(e) {
  e.preventDefault();
  if (!state.currentUser) return alert('Please sign in first.');

  const alertData = {
    title: document.getElementById('alertFormTitle').value.trim(),
    severity: document.getElementById('alertFormSeverity').value,
    description: document.getElementById('alertFormDesc').value.trim(),
    resolved: false,
    created_at: new Date().toISOString(),
  };

  try {
    await db.collection('users').doc(state.currentUser.uid).collection('alerts').add(alertData);
    closeModal('alertModal');
  } catch (err) {
    alert('Failed to save alert to Firestore: ' + err.message);
  }
}

async function resolveAlert(id) {
  if (!state.currentUser) return;
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('alerts').doc(id).update({
      resolved: true,
      resolved_at: new Date().toISOString(),
    });
  } catch (err) {
    alert('Resolve failed: ' + err.message);
  }
}

async function deleteAlert(id) {
  if (!state.currentUser) return;
  try {
    await db.collection('users').doc(state.currentUser.uid).collection('alerts').doc(id).delete();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ── Autonomous Agent Execution for User's Real Firestore Items ───────────────
async function triggerAgentRun() {
  if (!state.currentUser) return alert('Please sign in first.');

  const btn = document.getElementById('runAgentBtn');
  const label = document.getElementById('runBtnLabel');
  const banner = document.getElementById('activeRunBanner');
  const pulse = document.getElementById('agentPulse');

  btn.disabled = true;
  label.textContent = 'Agent Executing...';
  banner.style.display = 'flex';
  pulse.className = 'pulse-ring running';

  try {
    // Send user's real Firestore items to backend agent
    const res = await fetch('/api/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: state.currentUser.uid,
        tasks: state.tasks,
        bills: state.bills,
      }),
    });

    const result = await res.json();

    // Store the resulting briefing into user's Firestore collection
    if (result.briefing) {
      await db.collection('users').doc(state.currentUser.uid).collection('briefings').add({
        content: result.briefing,
        tasks_handled: result.tasks_handled,
        alerts_raised: result.alerts_raised,
        created_at: new Date().toISOString(),
      });
    }

    // Store any new alerts generated by the agent into user's Firestore collection
    if (result.alerts && result.alerts.length) {
      for (const al of result.alerts) {
        await db.collection('users').doc(state.currentUser.uid).collection('alerts').add({
          title: al.title,
          description: al.description,
          severity: al.severity,
          resolved: false,
          created_at: new Date().toISOString(),
        });
      }
    }

  } catch (err) {
    alert('Agent run error: ' + err.message);
  } finally {
    btn.disabled = false;
    label.textContent = 'Run Agent Now';
    banner.style.display = 'none';
    pulse.className = 'pulse-ring';
  }
}

// ── Authentication Gate Methods ──────────────────────────────────────────────
async function gateEmailSignIn() {
  if (!auth) return alert('Connecting to Firebase...');
  const email = document.getElementById('gateEmail').value.trim();
  const pass = document.getElementById('gatePassword').value;
  if (!email || !pass) return alert('Please enter both email and password.');

  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    alert('Sign in failed: ' + err.message);
  }
}

async function gateEmailSignUp() {
  if (!auth) return alert('Connecting to Firebase...');
  const email = document.getElementById('gateEmail').value.trim();
  const pass = document.getElementById('gatePassword').value;
  if (!email || !pass) return alert('Please enter both email and password.');

  try {
    await auth.createUserWithEmailAndPassword(email, pass);
  } catch (err) {
    alert('Account creation failed: ' + err.message);
  }
}

async function gateAnonymousSignIn() {
  if (!auth) return alert('Connecting to Firebase...');
  try {
    await auth.signInAnonymously();
  } catch (err) {
    alert('Guest sign-in failed: ' + err.message);
  }
}

async function handleSignOut() {
  if (!auth) return;
  await auth.signOut();
}

// ── Scheduler Controls ───────────────────────────────────────────────────────
async function loadSchedulerInfo() {
  try {
    const res = await fetch('/api/scheduler');
    const sched = await res.json();
    state.scheduler = sched;
    updateSchedulerUI(sched);
  } catch (e) {
    console.warn('Failed to load scheduler info:', e);
  }
}

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
    nextEl.textContent = 'Next run: schedule paused';
  } else {
    statusEl.textContent = `Active · Sweeping every ${mins} minute(s)`;
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
    alert('Interval update failed: ' + err.message);
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
    alert('Toggle failed: ' + err.message);
  }
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

function openScheduleModal() {
  openModal('scheduleModal');
}

function loadBriefing() {
  renderBriefing();
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
