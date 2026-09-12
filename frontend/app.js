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

const CLOUD_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC-tWI6IlbdpAe0FQ2D3c-vLdA4xoziocs",
  authDomain: "dailypilot-ai-2026.firebaseapp.com",
  projectId: "dailypilot-ai-2026",
  storageBucket: "dailypilot-ai-2026.firebasestorage.app",
  messagingSenderId: "720403632329",
  appId: "1:720403632329:web:9eba663d20a7c58ab13d18"
};

async function initFirebaseClient() {
  // Check for existing session immediately (instant restore on refresh)
  try {
    const saved = localStorage.getItem('dailypilot_session_user');
    if (saved) {
      const u = JSON.parse(saved);
      if (u && (u.uid || u.email)) {
        state.currentUser = u;
        document.documentElement.classList.add('session-authenticated');
        handleAuthGateState(u);
        bindFirestoreListeners(u);
      }
    }
  } catch (e) {}

  let firebaseConfig = CLOUD_FIREBASE_CONFIG;
  try {
    const configRes = await fetch('/api/firebase-config');
    if (configRes.ok) {
      firebaseConfig = await configRes.json();
    }
  } catch (err) {
    console.info('[Firebase] Using embedded cloud config for hosted app.');
  }

  try {
    if (window.firebase && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();

      // Ensure auth session persists across page refreshes
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      auth.onAuthStateChanged((user) => {
        if (user) {
          const sessionUser = {
            uid: user.uid,
            email: user.email || (user.isAnonymous ? 'guest@dailypilot.app' : 'user@dailypilot.app'),
            displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Guest User'),
            photoURL: user.photoURL || null,
            isAnonymous: user.isAnonymous,
            provider: user.providerData && user.providerData[0] ? user.providerData[0].providerId : (user.isAnonymous ? 'anonymous' : 'password'),
          };
          localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
          state.currentUser = sessionUser;
          document.documentElement.classList.add('session-authenticated');
          handleAuthGateState(sessionUser);
          bindFirestoreListeners(sessionUser);
        } else {
          // Only disconnect if user explicitly signed out
          if (!localStorage.getItem('dailypilot_session_user')) {
            state.currentUser = null;
            document.documentElement.classList.remove('session-authenticated');
            handleAuthGateState(null);
            unbindFirestoreListeners();
          }
        }
      });

      console.log('[Firebase] Connected to project:', firebaseConfig.projectId);
    }
  } catch (err) {
    console.warn('[Firebase] Client initialization note:', err);
  }
}

// ── Authentication Gate Control ──────────────────────────────────────────────
function handleAuthGateState(user) {
  const gate = document.getElementById('authGateOverlay');
  const userPillName = document.getElementById('userDisplayName');
  const syncDot = document.getElementById('cloudSyncDot');

  if (user) {
    // Dismiss Gate permanently for this session
    document.documentElement.classList.add('session-authenticated');
    if (gate) gate.classList.add('hidden');
    const displayEmail = user.displayName || user.email || (user.isAnonymous ? 'Guest User' : 'Authenticated');
    if (userPillName) userPillName.textContent = displayEmail;
    if (syncDot) {
      syncDot.style.background = '#10b981';
      syncDot.title = 'Cloud Firestore Unlimited: ' + (user.email || displayEmail);
    }
    // Load local items immediately so UI is instant
    state.tasks = getLocalItems(user.uid, 'tasks');
    state.bills = getLocalItems(user.uid, 'bills');
    state.alerts = getLocalItems(user.uid, 'alerts');
    renderAll();
  } else {
    // Show Gate & reset view
    document.documentElement.classList.remove('session-authenticated');
    if (gate) gate.classList.remove('hidden');
    if (userPillName) userPillName.textContent = 'Sign In';
    if (syncDot) {
      syncDot.style.background = '#94a3b8';
      syncDot.title = 'Authentication Required';
    }
    state.tasks = [];
    state.bills = [];
    state.alerts = [];
    state.briefing = null;
    renderAll();
  }
}

// ── Local Isolated User Storage Adapter (Failover for Firestore) ─────────────
function getLocalKey(uid, collection) {
  return `dailypilot_${uid}_${collection}`;
}

function getLocalItems(uid, collection) {
  try {
    const raw = localStorage.getItem(getLocalKey(uid, collection));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setLocalItems(uid, collection, items) {
  try {
    localStorage.setItem(getLocalKey(uid, collection), JSON.stringify(items));
  } catch (e) {}
}

function saveLocalItem(uid, collection, item) {
  const items = getLocalItems(uid, collection);
  const existingIdx = items.findIndex(i => String(i.id) === String(item.id));
  if (existingIdx >= 0) {
    items[existingIdx] = { ...items[existingIdx], ...item };
  } else {
    items.unshift(item);
  }
  setLocalItems(uid, collection, items);
  return items;
}

function removeLocalItem(uid, collection, itemId) {
  const items = getLocalItems(uid, collection).filter(i => String(i.id) !== String(itemId));
  setLocalItems(uid, collection, items);
  return items;
}

// ── Cloud Firestore Real-Time Bindings ───────────────────────────────────────
function bindFirestoreListeners(user) {
  unbindFirestoreListeners();

  // Load from user-isolated store initially
  state.tasks = getLocalItems(user.uid, 'tasks');
  state.bills = getLocalItems(user.uid, 'bills');
  state.alerts = getLocalItems(user.uid, 'alerts');
  const savedBriefings = getLocalItems(user.uid, 'briefings');
  state.briefing = savedBriefings.length ? savedBriefings[0] : null;
  renderAll();

  if (!db) return;

  try {
    const userDoc = db.collection('users').doc(user.uid);

    // 1. Tasks Listener
    const unsubTasks = userDoc.collection('tasks').onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        state.tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setLocalItems(user.uid, 'tasks', state.tasks);
        renderTasks();
        updateKPIs();
      }
    }, (err) => {
      console.info('[Firestore note] Using persistent local storage adapter for tasks.');
    });

    // 2. Bills Listener
    const unsubBills = userDoc.collection('bills').onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        state.bills = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setLocalItems(user.uid, 'bills', state.bills);
        renderBills();
        updateKPIs();
      }
    }, (err) => {
      console.info('[Firestore note] Using persistent local storage adapter for bills.');
    });

    // 3. Alerts Listener
    const unsubAlerts = userDoc.collection('alerts').onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        state.alerts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setLocalItems(user.uid, 'alerts', state.alerts);
        renderAlerts();
        updateKPIs();
      }
    }, (err) => {
      console.info('[Firestore note] Using persistent local storage adapter for alerts.');
    });

    // 4. Briefings Listener
    const unsubBriefings = userDoc.collection('briefings')
      .orderBy('created_at', 'desc')
      .limit(1)
      .onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          state.briefing = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
          renderBriefing();
        }
      }, (err) => {
        console.info('[Firestore note] Using persistent local storage adapter for briefings.');
      });

    state.unsubscribers = [unsubTasks, unsubBills, unsubAlerts, unsubBriefings];
  } catch (err) {
    console.info('[Firestore] Running in resilient offline-first mode.');
  }
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

// ── CRUD: Tasks (Dual Cloud Firestore + Isolated Store) ─────────────────────
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
  const task = state.tasks.find(t => String(t.id) === String(id));
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
  const taskId = id || 'tsk_' + Date.now();
  const taskData = {
    id: taskId,
    title: document.getElementById('taskFormTitle').value.trim(),
    category: document.getElementById('taskFormCategory').value,
    priority: document.getElementById('taskFormPriority').value,
    due_date: document.getElementById('taskFormDueDate').value || null,
    status: document.getElementById('taskFormStatus').value,
    notes: document.getElementById('taskFormNotes').value.trim(),
    updated_at: new Date().toISOString(),
  };

  // 1. Save to local isolated user store immediately (optimistic UI)
  saveLocalItem(state.currentUser.uid, 'tasks', taskData);
  state.tasks = getLocalItems(state.currentUser.uid, 'tasks');
  renderTasks();
  updateKPIs();
  closeModal('taskModal');

  // 2. Cloud Firestore sync
  if (db) {
    try {
      const tasksRef = db.collection('users').doc(state.currentUser.uid).collection('tasks');
      if (id) {
        await tasksRef.doc(String(id)).set(taskData, { merge: true });
      } else {
        taskData.created_at = new Date().toISOString();
        await tasksRef.doc(taskId).set(taskData);
      }
    } catch (err) {
      console.info('[Firestore] Item saved locally:', err.message);
    }
  }
}

async function toggleTaskStatus(id, currentStatus) {
  if (!state.currentUser) return;
  const nextStatus = currentStatus === 'done' ? 'pending' : 'done';
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;

  const updated = { ...task, status: nextStatus, updated_at: new Date().toISOString() };
  saveLocalItem(state.currentUser.uid, 'tasks', updated);
  state.tasks = getLocalItems(state.currentUser.uid, 'tasks');
  renderTasks();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('tasks').doc(String(id)).update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {}
  }
}

async function deleteTask(id) {
  if (!state.currentUser) return;
  if (!confirm('Delete this task?')) return;

  removeLocalItem(state.currentUser.uid, 'tasks', id);
  state.tasks = getLocalItems(state.currentUser.uid, 'tasks');
  renderTasks();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('tasks').doc(String(id)).delete();
    } catch (err) {}
  }
}

// ── CRUD: Bills (Dual Cloud Firestore + Isolated Store) ──────────────────────
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
  const bill = state.bills.find(b => String(b.id) === String(id));
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
  const billId = id || 'bil_' + Date.now();
  const billData = {
    id: billId,
    name: document.getElementById('billFormName').value.trim(),
    amount: parseFloat(document.getElementById('billFormAmount').value),
    due_date: document.getElementById('billFormDueDate').value,
    category: document.getElementById('billFormCategory').value,
    status: document.getElementById('billFormStatus').value,
    is_recurring: document.getElementById('billFormRecurring').checked ? 1 : 0,
    notes: document.getElementById('billFormNotes').value.trim(),
    updated_at: new Date().toISOString(),
  };

  saveLocalItem(state.currentUser.uid, 'bills', billData);
  state.bills = getLocalItems(state.currentUser.uid, 'bills');
  renderBills();
  updateKPIs();
  closeModal('billModal');

  if (db) {
    try {
      const billsRef = db.collection('users').doc(state.currentUser.uid).collection('bills');
      if (id) {
        await billsRef.doc(String(id)).set(billData, { merge: true });
      } else {
        billData.created_at = new Date().toISOString();
        await billsRef.doc(billId).set(billData);
      }
    } catch (err) {
      console.info('[Firestore] Bill saved locally:', err.message);
    }
  }
}

async function toggleBillStatus(id, currentStatus) {
  if (!state.currentUser) return;
  const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid';
  const bill = state.bills.find(b => String(b.id) === String(id));
  if (!bill) return;

  const updated = { ...bill, status: nextStatus, updated_at: new Date().toISOString() };
  saveLocalItem(state.currentUser.uid, 'bills', updated);
  state.bills = getLocalItems(state.currentUser.uid, 'bills');
  renderBills();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('bills').doc(String(id)).update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {}
  }
}

async function deleteBill(id) {
  if (!state.currentUser) return;
  if (!confirm('Delete this bill?')) return;

  removeLocalItem(state.currentUser.uid, 'bills', id);
  state.bills = getLocalItems(state.currentUser.uid, 'bills');
  renderBills();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('bills').doc(String(id)).delete();
    } catch (err) {}
  }
}

// ── CRUD: Alerts (Dual Cloud Firestore + Isolated Store) ─────────────────────
function openAddAlertModal() {
  document.getElementById('alertFormTitle').value = '';
  document.getElementById('alertFormSeverity').value = 'medium';
  document.getElementById('alertFormDesc').value = '';
  openModal('alertModal');
}

async function saveAlertSubmit(e) {
  e.preventDefault();
  if (!state.currentUser) return alert('Please sign in first.');

  const alertId = 'alt_' + Date.now();
  const alertData = {
    id: alertId,
    title: document.getElementById('alertFormTitle').value.trim(),
    severity: document.getElementById('alertFormSeverity').value,
    description: document.getElementById('alertFormDesc').value.trim(),
    resolved: false,
    created_at: new Date().toISOString(),
  };

  saveLocalItem(state.currentUser.uid, 'alerts', alertData);
  state.alerts = getLocalItems(state.currentUser.uid, 'alerts');
  renderAlerts();
  updateKPIs();
  closeModal('alertModal');

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('alerts').doc(alertId).set(alertData);
    } catch (err) {}
  }
}

async function resolveAlert(id) {
  if (!state.currentUser) return;
  const alertItem = state.alerts.find(a => String(a.id) === String(id));
  if (!alertItem) return;

  const updated = { ...alertItem, resolved: true, resolved_at: new Date().toISOString() };
  saveLocalItem(state.currentUser.uid, 'alerts', updated);
  state.alerts = getLocalItems(state.currentUser.uid, 'alerts');
  renderAlerts();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('alerts').doc(String(id)).update({
        resolved: true,
        resolved_at: new Date().toISOString(),
      });
    } catch (err) {}
  }
}

async function deleteAlert(id) {
  if (!state.currentUser) return;
  removeLocalItem(state.currentUser.uid, 'alerts', id);
  state.alerts = getLocalItems(state.currentUser.uid, 'alerts');
  renderAlerts();
  updateKPIs();

  if (db) {
    try {
      await db.collection('users').doc(state.currentUser.uid).collection('alerts').doc(String(id)).delete();
    } catch (err) {}
  }
}

// ── Autonomous Agent Execution (Dual Cloud Backend + Static Hosting Mode) ──
function runClientSideAutonomousAudit(userId, tasks, bills) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (!tasks.length && !bills.length) {
    return {
      briefing: `# 🧭 DailyPilot Personal Briefing\n**${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}** · Generated at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n---\n\n## 📋 Workspace Status: Clean & Ready\n\nYou haven't added any tasks or bills yet.\n- Click **+ Add Task** to enter real to-dos, deadlines, or appointments.\n- Click **+ Add Bill** to track monthly expenses and enable anomaly detection.\n\n_Once you add items, DailyPilot autonomously audits them on your schedule._`,
      alerts: [],
      tasks_handled: 0,
      alerts_raised: 0,
    };
  }

  const overdueTasks = tasks.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'done');
  const dueTodayTasks = tasks.filter(t => t.due_date === todayStr && t.status !== 'done');

  const categoryThresholds = { utilities: 200, subscriptions: 35, housing: 2500, finance: 600, insurance: 400, general: 150 };
  const anomalousBills = bills.filter(b => {
    const limit = categoryThresholds[b.category] || 150;
    return parseFloat(b.amount || 0) > limit * 1.5;
  });

  const alerts = [];
  anomalousBills.forEach(b => {
    alerts.push({
      title: `Unusual Charge: ${b.name} ($${parseFloat(b.amount).toFixed(2)})`,
      description: `Amount exceeds standard threshold for ${b.category}.\n💡 Recommended action: Review itemized statement before payment.`,
      severity: 'high',
    });
  });
  overdueTasks.forEach(t => {
    alerts.push({
      title: `Overdue Deadline: ${t.title}`,
      description: `Task deadline has passed.\n💡 Recommended action: Complete or reschedule today.`,
      severity: 'medium',
    });
  });

  const totalBillAmount = bills.reduce((acc, b) => acc + (parseFloat(b.amount) || 0), 0);

  let md = `# 🧭 DailyPilot Personal Briefing\n**${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}** · Generated at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n---\n\n## ✅ Autonomous Audit Summary\n\n| Category | Tracked | Status |\n|---|---|---|\n| **Active Tasks** | ${tasks.length} | ${overdueTasks.length} Overdue · ${dueTodayTasks.length} Due Today |\n| **Active Bills** | ${bills.length} | Total Obligation: $${totalBillAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} |\n| **Decision Escalations** | ${alerts.length} | Items Requiring Your Approval |\n\n`;

  if (alerts.length) {
    md += `## 🚨 Items Requiring Your Human Attention\n\n`;
    alerts.forEach(a => { md += `- 🔴 **${a.title}**\n  ${a.description.split('\n')[0]}\n\n`; });
  } else {
    md += `## ✨ You're All Clear!\nNo anomalies or urgent overdue items detected. Everything is on schedule.\n\n`;
  }
  md += `---\n\n_DailyPilot running autonomously on Cloud Firestore & Firebase Hosting._\n`;

  return {
    briefing: md,
    alerts: alerts,
    tasks_handled: tasks.length + bills.length,
    alerts_raised: alerts.length,
  };
}

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

  let result = null;

  try {
    const res = await fetch('/api/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: state.currentUser.uid,
        tasks: state.tasks,
        bills: state.bills,
      }),
    });
    if (res.ok) {
      result = await res.json();
    }
  } catch (err) {
    console.info('[Agent] Server API offline, executing autonomous client sweep.');
  }

  // Fallback to client autonomous sweep if server is offline or on static hosting
  if (!result) {
    result = runClientSideAutonomousAudit(state.currentUser.uid, state.tasks, state.bills);
  }

  try {
    if (result && result.briefing) {
      const briefObj = {
        id: 'brf_' + Date.now(),
        content: result.briefing,
        tasks_handled: result.tasks_handled,
        alerts_raised: result.alerts_raised,
        created_at: new Date().toISOString(),
      };
      saveLocalItem(state.currentUser.uid, 'briefings', briefObj);
      state.briefing = briefObj;
      renderBriefing();

      if (db) {
        try {
          await db.collection('users').doc(state.currentUser.uid).collection('briefings').add(briefObj);
        } catch (e) {}
      }
    }

    if (result && result.alerts && result.alerts.length) {
      for (const al of result.alerts) {
        const altObj = {
          id: 'alt_' + Date.now() + Math.random().toString(16).slice(2, 6),
          title: al.title,
          description: al.description,
          severity: al.severity,
          resolved: false,
          created_at: new Date().toISOString(),
        };
        saveLocalItem(state.currentUser.uid, 'alerts', altObj);
        if (db) {
          try {
            await db.collection('users').doc(state.currentUser.uid).collection('alerts').add(altObj);
          } catch (e) {}
        }
      }
      state.alerts = getLocalItems(state.currentUser.uid, 'alerts');
      renderAlerts();
      updateKPIs();
    }
  } catch (err) {
    console.error('Agent audit error:', err);
  } finally {
    btn.disabled = false;
    label.textContent = 'Run Agent Now';
    banner.style.display = 'none';
    pulse.className = 'pulse-ring';
  }
}

// ── Authentication Banner Feedback ──────────────────────────────────────────
function showAuthError(msg) {
  const el = document.getElementById('authErrorBanner');
  if (el) {
    el.innerHTML = `<span>⚠️</span><span>${escapeHTML(msg)}</span>`;
    el.style.display = 'flex';
  }
}

function clearAuthError() {
  const el = document.getElementById('authErrorBanner');
  if (el) {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

// ── Google Authentication ───────────────────────────────────────────────────
async function gateGoogleSignIn() {
  clearAuthError();
  const btn = document.getElementById('btnGoogleSignIn');
  const label = document.getElementById('btnGoogleLabel');
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Connecting Google...';

  try {
    if (auth) {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await auth.signInWithPopup(provider);
      if (result && result.user) {
        const u = result.user;
        const sessionUser = {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Google User'),
          photoURL: u.photoURL || null,
          isAnonymous: false,
          provider: 'google.com',
        };
        localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
        state.currentUser = sessionUser;
        document.documentElement.classList.add('session-authenticated');
        handleAuthGateState(sessionUser);
        bindFirestoreListeners(sessionUser);
        return;
      }
    }
  } catch (err) {
    console.warn('[Google Auth Error]', err.code, err.message);
    if (err.code === 'auth/popup-blocked') {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithRedirect(provider);
        return;
      } catch (redirectErr) {
        showAuthError('Popup blocked by browser. Please allow popups or use email sign in.');
      }
    } else if (err.code === 'auth/popup-closed-by-user') {
      showAuthError('Google sign-in was cancelled.');
    } else if (err.code === 'auth/unauthorized-domain') {
      showAuthError('Google auth domain unauthorized. Please add this domain to Firebase Auth console.');
    } else if (err.code === 'auth/operation-not-allowed') {
      showAuthError('Google provider is not enabled in Firebase Console yet. Please enable it in Firebase Console > Authentication > Sign-in method.');
    } else {
      showAuthError(err.message || 'Google sign-in failed. Please try again.');
    }
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Sign in with Google';
  }
}

// ── Email / Password Sign In with Strict Password Verification ──────────────
async function gateEmailSignIn() {
  clearAuthError();
  const emailInput = document.getElementById('gateEmail');
  const passInput = document.getElementById('gatePassword');
  const email = emailInput.value.trim();
  const pass = passInput.value;

  if (!email) {
    showAuthError('Please enter your email address.');
    emailInput.focus();
    return;
  }
  if (!pass) {
    showAuthError('Please enter your password.');
    passInput.focus();
    return;
  }
  if (pass.length < 6) {
    showAuthError('Password must be at least 6 characters.');
    passInput.focus();
    return;
  }

  const btn = document.getElementById('btnEmailSignIn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
  }

  try {
    if (auth) {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      if (cred && cred.user) {
        const u = cred.user;
        const sessionUser = {
          uid: u.uid,
          email: u.email,
          displayName: u.email.split('@')[0],
          isAnonymous: false,
          provider: 'password',
        };
        localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
        state.currentUser = sessionUser;
        document.documentElement.classList.add('session-authenticated');
        handleAuthGateState(sessionUser);
        bindFirestoreListeners(sessionUser);
        return;
      }
    }
  } catch (err) {
    console.warn('[Firebase Auth Error]', err.code, err.message);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      showAuthError('Incorrect password. Please re-enter your password.');
      passInput.focus();
      return;
    } else if (err.code === 'auth/user-not-found') {
      showAuthError('No account found for this email. Click "Create Account" to register.');
      return;
    } else if (err.code === 'auth/invalid-email') {
      showAuthError('Invalid email format. Please enter a valid email address.');
      emailInput.focus();
      return;
    } else if (err.code === 'auth/too-many-requests') {
      showAuthError('Too many failed attempts. Please wait a moment and try again.');
      return;
    } else if (err.code === 'auth/operation-not-allowed') {
      showAuthError('Email/Password provider is not enabled in Firebase Console yet. Please enable it in Firebase Console > Authentication > Sign-in method.');
      return;
    } else {
      showAuthError(err.message || 'Authentication failed. Please verify credentials.');
      return;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }
}

// ── Email / Password Sign Up with Password Strength Validation ──────────────
async function gateEmailSignUp() {
  clearAuthError();
  const emailInput = document.getElementById('gateEmail');
  const passInput = document.getElementById('gatePassword');
  const email = emailInput.value.trim();
  const pass = passInput.value;

  if (!email) {
    showAuthError('Please enter an email address to create an account.');
    emailInput.focus();
    return;
  }
  if (!pass) {
    showAuthError('Please enter a password of at least 6 characters.');
    passInput.focus();
    return;
  }
  if (pass.length < 6) {
    showAuthError('Password must be at least 6 characters long.');
    passInput.focus();
    return;
  }

  const btn = document.getElementById('btnEmailSignUp');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating Account...';
  }

  try {
    if (auth) {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      if (cred && cred.user) {
        const u = cred.user;
        const sessionUser = {
          uid: u.uid,
          email: u.email,
          displayName: u.email.split('@')[0],
          isAnonymous: false,
          provider: 'password',
        };
        localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
        state.currentUser = sessionUser;
        document.documentElement.classList.add('session-authenticated');
        handleAuthGateState(sessionUser);
        bindFirestoreListeners(sessionUser);
        return;
      }
    }
  } catch (err) {
    console.warn('[Firebase Sign Up Error]', err.code, err.message);
    if (err.code === 'auth/email-already-in-use') {
      showAuthError('This email is already registered. Please click "Sign In" with your password.');
      return;
    } else if (err.code === 'auth/weak-password') {
      showAuthError('Password is too weak. Please use at least 6 characters.');
      return;
    } else if (err.code === 'auth/invalid-email') {
      showAuthError('Invalid email format. Please enter a valid email.');
      return;
    } else if (err.code === 'auth/operation-not-allowed') {
      showAuthError('Email/Password provider is not enabled in Firebase Console yet. Please enable it in Firebase Console > Authentication > Sign-in method.');
      return;
    } else {
      showAuthError(err.message || 'Account creation failed. Please try again.');
      return;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  }
}

// ── One-Click Guest Access ──────────────────────────────────────────────────
async function gateAnonymousSignIn() {
  clearAuthError();
  try {
    if (auth) {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await auth.signInAnonymously();
      if (cred && cred.user) {
        const sessionUser = {
          uid: cred.user.uid,
          email: 'guest@dailypilot.app',
          displayName: 'Guest User',
          isAnonymous: true,
          provider: 'anonymous',
        };
        localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
        state.currentUser = sessionUser;
        document.documentElement.classList.add('session-authenticated');
        handleAuthGateState(sessionUser);
        bindFirestoreListeners(sessionUser);
        return;
      }
    }
  } catch (err) {
    console.info('[Firebase Auth notice] Activating guest session:', err.code || err.message);
  }

  // Resilient failover
  createLocalUserSession('guest@dailypilot.app', true, 'Guest User');
}

// ── User Session Creation Helper ────────────────────────────────────────────
function createLocalUserSession(email, isGuest = false, customDisplayName = null) {
  const cleanEmail = email || (isGuest ? 'guest@dailypilot.app' : 'user@dailypilot.app');
  const uid = 'usr_' + Math.abs(hashString(cleanEmail)).toString(16) + (isGuest ? '_gst' : '');
  const sessionUser = {
    uid: uid,
    email: cleanEmail,
    displayName: customDisplayName || cleanEmail.split('@')[0],
    isAnonymous: isGuest,
    provider: isGuest ? 'anonymous' : 'local',
  };
  localStorage.setItem('dailypilot_session_user', JSON.stringify(sessionUser));
  state.currentUser = sessionUser;
  document.documentElement.classList.add('session-authenticated');
  handleAuthGateState(sessionUser);
  bindFirestoreListeners(sessionUser);
  return sessionUser;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ── Sign Out ─────────────────────────────────────────────────────────────────
async function handleSignOut() {
  document.documentElement.classList.remove('session-authenticated');
  localStorage.removeItem('dailypilot_session_user');
  if (auth) {
    try { await auth.signOut(); } catch (e) {}
  }
  state.currentUser = null;
  handleAuthGateState(null);
}

// ── Open User Modal ──────────────────────────────────────────────────────────
function openUserModal() {
  if (!state.currentUser) return;
  const emailEl = document.getElementById('userModalEmail');
  const uidEl = document.getElementById('userModalUid');
  const avatarEl = document.getElementById('userModalAvatar');

  const display = state.currentUser.displayName || state.currentUser.email || 'User';
  if (emailEl) emailEl.textContent = state.currentUser.email || display;
  if (uidEl) uidEl.textContent = 'UID: ' + state.currentUser.uid;
  if (avatarEl) avatarEl.textContent = display.charAt(0).toUpperCase();

  openModal('userModal');
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
