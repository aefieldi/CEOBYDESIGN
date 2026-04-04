// ════════════════════════════════════════════════════
// FIREBASE CLOUD SYNC — CEO BY DESIGN · FOUNDER OS
// Drop this file alongside your HTML on GitHub Pages.
// ════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC0TeL3B276Qfe6MKhumezf6aX710b23WA",
  authDomain: "ceo-os-412d9.firebaseapp.com",
  projectId: "ceo-os-412d9",
  storageBucket: "ceo-os-412d9.firebasestorage.app",
  messagingSenderId: "704510348100",
  appId: "1:704510348100:web:a1701ffd81b4caac142511"
};

// ── All localStorage keys your app uses ──
const SYNC_KEYS = [
  'vbd_v4',           // Main data (profile + days)
  'fos_dtq_v1',       // Daily Task Queue
  'fos_tasks',        // Weekly Rhythm tasks
  'fos_ideas',        // Idea Vault
  'fos_snaps',        // Monthly Snapshots
  'fos_weekreviews',  // Weekly Reviews
  'fos_weektasks',    // Week Task List sidebar
  'fos_backlog',      // Backlog Pool
  'fos_deleted_ev',   // Deleted evening ideas
  'sbs_video_ideas_v2' // Video Library
];
// Weekly check keys are dynamic (fos_checks_YYYY_WXX) — handled separately

// ── State ──
let fbApp = null;
let fbDb = null;
let fbAuth = null;
let fbUser = null;
let syncDebounceTimer = null;
let isSyncing = false;
let lastSyncTime = 0;

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
function initFirebaseSync() {
  // Wait for Firebase SDK to load
  if (typeof firebase === 'undefined') {
    console.warn('[Sync] Firebase SDK not loaded yet, retrying...');
    setTimeout(initFirebaseSync, 500);
    return;
  }

  fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  fbDb = firebase.firestore();
  fbAuth = firebase.auth();

  // Build the auth UI
  buildSyncUI();

  // Listen for auth state
  fbAuth.onAuthStateChanged(function(user) {
    fbUser = user;
    updateSyncUI();
    if (user) {
      console.log('[Sync] Signed in as', user.email);
      pullFromCloud();
    }
  });

  // Override the original save function to also sync to cloud
  patchSaveFunction();

  console.log('[Sync] Firebase sync initialized');
}

// ════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════
function signInWithGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  fbAuth.signInWithPopup(provider).catch(function(err) {
    console.error('[Sync] Sign-in error:', err);
    alert('Sign-in failed: ' + err.message);
  });
}

function signOutSync() {
  fbAuth.signOut().then(function() {
    fbUser = null;
    updateSyncUI();
  });
}

// ════════════════════════════════════════════════════
// UI — Sync bar at top of header
// ════════════════════════════════════════════════════
function buildSyncUI() {
  var bar = document.createElement('div');
  bar.id = 'syncBar';
  bar.innerHTML = '';
  bar.style.cssText = 'text-align:center;padding:8px 16px;font-family:Montserrat,sans-serif;font-size:.72em;font-weight:700;letter-spacing:.5px;position:relative;z-index:101;background:rgba(20,14,55,0.85);border-bottom:1px solid rgba(160,148,240,0.15)';

  // Insert before the momentum bar
  var mb = document.getElementById('momentumBar');
  if (mb && mb.parentNode) {
    mb.parentNode.insertBefore(bar, mb);
  } else {
    document.body.prepend(bar);
  }
  updateSyncUI();
}

function updateSyncUI() {
  var bar = document.getElementById('syncBar');
  if (!bar) return;

  if (fbUser) {
    var syncAgo = lastSyncTime ? timeSince(lastSyncTime) : 'not yet';
    bar.innerHTML =
      '<span style="color:rgba(125,212,200,0.9)">☁️ SYNCED</span>' +
      '<span style="color:var(--muted);margin:0 10px">·</span>' +
      '<span style="color:var(--muted)">' + fbUser.email + '</span>' +
      '<span style="color:var(--muted);margin:0 10px">·</span>' +
      '<span style="color:var(--muted)">Last sync: <span id="syncAgoText">' + syncAgo + '</span></span>' +
      '<span style="color:var(--muted);margin:0 10px">·</span>' +
      '<button onclick="forcePush()" style="background:none;border:1px solid rgba(160,148,240,0.3);color:var(--p400);padding:3px 10px;border-radius:12px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:700;cursor:pointer;margin:0 4px;text-transform:uppercase;letter-spacing:.5px">↑ Push</button>' +
      '<button onclick="forcePull()" style="background:none;border:1px solid rgba(160,148,240,0.3);color:var(--pk400);padding:3px 10px;border-radius:12px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:700;cursor:pointer;margin:0 4px;text-transform:uppercase;letter-spacing:.5px">↓ Pull</button>' +
      '<button onclick="downloadBackup()" style="background:none;border:1px solid rgba(196,168,74,0.4);color:var(--gold);padding:3px 10px;border-radius:12px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:700;cursor:pointer;margin:0 4px;text-transform:uppercase;letter-spacing:.5px">💾 Backup</button>' +
      '<button onclick="signOutSync()" style="background:none;border:1px solid rgba(180,100,100,0.3);color:rgba(180,100,100,0.7);padding:3px 10px;border-radius:12px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:700;cursor:pointer;margin:0 4px;text-transform:uppercase;letter-spacing:.5px">Sign Out</button>';
  } else {
    bar.innerHTML =
      '<span style="color:rgba(196,168,74,0.9)">⚠️ NOT SYNCED</span>' +
      '<span style="color:var(--muted);margin:0 10px">·</span>' +
      '<span style="color:var(--muted)">Data is only saved in this browser</span>' +
      '<span style="color:var(--muted);margin:0 10px">·</span>' +
      '<button onclick="signInWithGoogle()" style="background:linear-gradient(135deg,var(--p400),var(--pk400));border:none;color:#fff;padding:5px 16px;border-radius:16px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:800;cursor:pointer;margin:0;text-transform:uppercase;letter-spacing:.8px;box-shadow:0 3px 12px rgba(155,126,212,0.25)">☁️ Sign In to Sync</button>' +
      '<button onclick="downloadBackup()" style="background:none;border:1px solid rgba(196,168,74,0.4);color:var(--gold);padding:3px 10px;border-radius:12px;font-family:Montserrat,sans-serif;font-size:.88em;font-weight:700;cursor:pointer;margin:0 4px;text-transform:uppercase;letter-spacing:.5px">💾 Backup</button>';
  }
}

function timeSince(ts) {
  var secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  return Math.floor(secs / 3600) + 'h ago';
}

// Update the "last sync" text every 30s
setInterval(function() {
  var el = document.getElementById('syncAgoText');
  if (el && lastSyncTime) el.textContent = timeSince(lastSyncTime);
}, 30000);

// ════════════════════════════════════════════════════
// PATCH SAVE — Intercept the existing save() function
// ════════════════════════════════════════════════════
function patchSaveFunction() {
  // Store reference to the original save function
  if (typeof window.save === 'function' && !window._originalSave) {
    window._originalSave = window.save;
    window.save = function() {
      // Call original save (writes to localStorage + shows pill)
      window._originalSave();
      // Debounced cloud sync
      debouncedCloudSync();
    };
    console.log('[Sync] Patched save() function');
  }

  // Also patch other save functions that don't go through save()
  var otherSavers = [
    'saveRTasks', 'saveRChecks', 'saveIdeas', 'saveSnaps',
    'saveWRs', 'saveWeekTasks', 'saveBacklog', 'saveDeletedEv',
    'vlSave', 'dtqSave'
  ];
  otherSavers.forEach(function(fnName) {
    if (typeof window[fnName] === 'function' && !window['_orig_' + fnName]) {
      window['_orig_' + fnName] = window[fnName];
      window[fnName] = function() {
        var args = Array.from(arguments);
        window['_orig_' + fnName].apply(window, args);
        debouncedCloudSync();
      };
    }
  });
}

// ════════════════════════════════════════════════════
// CLOUD SYNC — Debounced push to Firestore
// ════════════════════════════════════════════════════
function debouncedCloudSync() {
  if (!fbUser) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(pushToCloud, 2000); // 2s debounce
}

function getAllLocalData() {
  var data = {};
  SYNC_KEYS.forEach(function(key) {
    var val = localStorage.getItem(key);
    if (val) data[key] = val; // Store as raw strings
  });
  // Grab dynamic weekly check keys
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.startsWith('fos_checks_')) {
      data[k] = localStorage.getItem(k);
    }
  }
  return data;
}

function pushToCloud() {
  if (!fbUser || isSyncing) return;
  isSyncing = true;

  var data = getAllLocalData();
  data._updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  data._email = fbUser.email;

  // Firestore doc limit is 1MB — split into chunks if needed
  // For a single-user planner this should be well under
  fbDb.collection('users').doc(fbUser.uid).set(data, { merge: true })
    .then(function() {
      lastSyncTime = Date.now();
      isSyncing = false;
      updateSyncUI();
      console.log('[Sync] Pushed to cloud');
    })
    .catch(function(err) {
      isSyncing = false;
      console.error('[Sync] Push error:', err);
    });
}

function pullFromCloud() {
  if (!fbUser) return;

  fbDb.collection('users').doc(fbUser.uid).get()
    .then(function(doc) {
      if (!doc.exists) {
        console.log('[Sync] No cloud data found — pushing local data up');
        pushToCloud();
        return;
      }
      var cloudData = doc.data();
      var localUpdated = false;

      // For each key in cloud data, check if local is empty or older
      Object.keys(cloudData).forEach(function(key) {
        if (key.startsWith('_')) return; // Skip metadata fields
        var localVal = localStorage.getItem(key);

        if (!localVal || localVal === '{}' || localVal === '[]' || localVal === 'null') {
          // Local is empty — use cloud data
          localStorage.setItem(key, cloudData[key]);
          localUpdated = true;
        } else if (key === 'vbd_v4') {
          // Smart merge for main data — merge days
          try {
            var localDB = JSON.parse(localVal);
            var cloudDB = JSON.parse(cloudData[key]);
            if (cloudDB.days) {
              Object.keys(cloudDB.days).forEach(function(ds) {
                if (!localDB.days[ds]) {
                  localDB.days[ds] = cloudDB.days[ds];
                  localUpdated = true;
                }
              });
            }
            if (cloudDB.profile && !localDB.profile.snap.done && cloudDB.profile.snap && cloudDB.profile.snap.done) {
              localDB.profile = cloudDB.profile;
              localUpdated = true;
            }
            if (localUpdated) {
              localStorage.setItem(key, JSON.stringify(localDB));
            }
          } catch (e) {
            console.warn('[Sync] Merge error for vbd_v4:', e);
          }
        }
      });

      lastSyncTime = Date.now();
      updateSyncUI();

      if (localUpdated) {
        console.log('[Sync] Merged cloud data into local — reloading');
        // Reload the page to pick up merged data
        location.reload();
      } else {
        console.log('[Sync] Local data is current');
        // Push local data to ensure cloud is up to date
        pushToCloud();
      }
    })
    .catch(function(err) {
      console.error('[Sync] Pull error:', err);
    });
}

// ════════════════════════════════════════════════════
// MANUAL CONTROLS
// ════════════════════════════════════════════════════
function forcePush() {
  if (!fbUser) { alert('Sign in first!'); return; }
  pushToCloud();
  showSyncNotice('↑ Pushed to cloud');
}

function forcePull() {
  if (!fbUser) { alert('Sign in first!'); return; }
  if (!confirm('Pull from cloud? This will overwrite your local data with what\'s in the cloud.')) return;

  fbDb.collection('users').doc(fbUser.uid).get()
    .then(function(doc) {
      if (!doc.exists) { alert('No cloud data found.'); return; }
      var cloudData = doc.data();
      Object.keys(cloudData).forEach(function(key) {
        if (key.startsWith('_')) return;
        localStorage.setItem(key, cloudData[key]);
      });
      showSyncNotice('↓ Pulled from cloud — reloading...');
      setTimeout(function() { location.reload(); }, 1000);
    })
    .catch(function(err) {
      alert('Pull failed: ' + err.message);
    });
}

// ════════════════════════════════════════════════════
// JSON BACKUP — Downloads everything as a file
// ════════════════════════════════════════════════════
function downloadBackup() {
  var data = {};
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key) {
      try {
        data[key] = JSON.parse(localStorage.getItem(key));
      } catch (e) {
        data[key] = localStorage.getItem(key);
      }
    }
  }
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  var today = new Date().toISOString().split('T')[0];
  a.download = 'ceo-os-full-backup-' + today + '.json';
  a.click();
  showSyncNotice('💾 Backup downloaded');
}

// ════════════════════════════════════════════════════
// RESTORE FROM BACKUP
// ════════════════════════════════════════════════════
function restoreFromBackup(jsonString) {
  try {
    var data = JSON.parse(jsonString);
    Object.keys(data).forEach(function(key) {
      var val = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
      localStorage.setItem(key, val);
    });
    if (fbUser) pushToCloud();
    location.reload();
  } catch (e) {
    alert('Restore failed: ' + e.message);
  }
}

// ════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════
function showSyncNotice(msg) {
  var pill = document.getElementById('savePill');
  if (pill) {
    pill.textContent = msg;
    pill.classList.add('show');
    setTimeout(function() {
      pill.classList.remove('show');
      pill.textContent = 'Saved ✓';
    }, 2500);
  }
}

// ════════════════════════════════════════════════════
// AUTO-INIT when DOM is ready
// ════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebaseSync);
} else {
  // Small delay to ensure the main app's save() is defined first
  setTimeout(initFirebaseSync, 300);
}
