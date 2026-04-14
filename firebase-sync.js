// ════════════════════════════════════════════════════
// FIREBASE CLOUD SYNC — CEO BY DESIGN · FOUNDER OS
// PATCHED v2 — fixes flashing sync bar, adds persistence,
// adds redirect fallback, guards against double-init.
// ════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC0TeL3B276Qfe6MKhumezf6aX710b23WA",
  authDomain: "ceo-os-412d9.firebaseapp.com",
  projectId: "ceo-os-412d9",
  storageBucket: "ceo-os-412d9.firebasestorage.app",
  messagingSenderId: "704510348100",
  appId: "1:704510348100:web:a1701ffd81b4caac142511"
};

const SYNC_KEYS = [
  'vbd_v4','fos_dtq_v1','fos_tasks','fos_ideas','fos_snaps',
  'fos_weekreviews','fos_weektasks','fos_backlog','fos_deleted_ev',
  'sbs_video_ideas_v2'
];

// ── State ──
let fbApp = null, fbDb = null, fbAuth = null, fbUser = null;
let syncDebounceTimer = null, isSyncing = false, lastSyncTime = 0;
let syncInitialized = false;   // NEW: prevents double-init
let lastAuthState = 'unknown'; // NEW: only rebuild UI on actual state change
let syncBarBuilt = false;      // NEW: build once, only update text after

// ════════════════════════════════════════════════════
// INIT — guarded against double-firing
// ════════════════════════════════════════════════════
function initFirebaseSync() {
  if (syncInitialized) return;                          // NEW guard
  if (typeof firebase === 'undefined') {
    console.warn('[Sync] Firebase SDK not loaded yet, retrying...');
    setTimeout(initFirebaseSync, 500);
    return;
  }
  syncInitialized = true;

  try {
    fbApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    fbDb = firebase.firestore();
    fbAuth = firebase.auth();
  } catch (e) {
    console.error('[Sync] Init failed:', e);
    return;
  }

  // ── CRITICAL: persist auth across page reloads ──
  fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(err){
    console.warn('[Sync] setPersistence failed:', err);
  });

  buildSyncUI();

  // ── Handle redirect sign-in result (mobile / popup-blocked browsers) ──
  fbAuth.getRedirectResult().then(function(result){
    if (result && result.user) console.log('[Sync] Signed in via redirect');
  }).catch(function(err){
    if (err && err.code !== 'auth/no-auth-event') {
      console.warn('[Sync] Redirect result error:', err);
    }
  });

  // ── Auth state listener — only re-render UI on actual changes ──
  fbAuth.onAuthStateChanged(function(user) {
    fbUser = user;
    var newState = user ? ('signed-in:' + user.uid) : 'signed-out';
    if (newState !== lastAuthState) {
      lastAuthState = newState;
      updateSyncUI();
      if (user) {
        console.log('[Sync] Signed in as', user.email);
        pullFromCloud();
      }
    }
  });

  patchSaveFunction();
  console.log('[Sync] Firebase sync initialized');
}

// ════════════════════════════════════════════════════
// AUTH — popup first, redirect fallback
// ════════════════════════════════════════════════════
function signInWithGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  fbAuth.signInWithPopup(provider).catch(function(err) {
    console.warn('[Sync] Popup failed, trying redirect:', err && err.code);
    // Common reasons popup fails: mobile browser, popup blocked,
    // third-party cookies blocked. Redirect works in all of those.
    if (err && (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request' ||
      err.code === 'auth/operation-not-supported-in-this-environment' ||
      err.code === 'auth/web-storage-unsupported'
    )) {
      fbAuth.signInWithRedirect(provider).catch(function(err2){
        alert('Sign-in failed: ' + err2.message);
      });
    } else {
      alert('Sign-in failed: ' + err.message);
    }
  });
}

function signOutSync() {
  fbAuth.signOut().then(function() {
    fbUser = null;
    lastAuthState = 'signed-out';
    updateSyncUI();
  });
}

// ════════════════════════════════════════════════════
// UI — build once, update text in place (no flashing)
// ════════════════════════════════════════════════════
function buildSyncUI() {
  if (syncBarBuilt) return;
  var existing = document.getElementById('syncBar');
  if (existing) existing.remove();

  var bar = document.createElement('div');
  bar.id = 'syncBar';
  bar.style.cssText = 'text-align:center;padding:8px 16px;font-family:Montserrat,sans-serif;font-size:.72em;font-weight:700;letter-spacing:.5px;position:relative;z-index:101;background:rgba(20,14,55,0.85);border-bottom:1px solid rgba(160,148,240,0.15)';

  var mb = document.getElementById('momentumBar');
  if (mb && mb.parentNode) mb.parentNode.insertBefore(bar, mb);
  else document.body.prepend(bar);

  syncBarBuilt = true;
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

setInterval(function() {
  var el = document.getElementById('syncAgoText');
  if (el && lastSyncTime) el.textContent = timeSince(lastSyncTime);
}, 30000);

// ════════════════════════════════════════════════════
// PATCH SAVE
// ════════════════════════════════════════════════════
function patchSaveFunction() {
  if (typeof window.save === 'function' && !window._originalSave) {
    window._originalSave = window.save;
    window.save = function() {
      window._originalSave();
      debouncedCloudSync();
    };
    console.log('[Sync] Patched save() function');
  }

  var otherSavers = [
    'saveRTasks','saveRChecks','saveIdeas','saveSnaps',
    'saveWRs','saveWeekTasks','saveBacklog','saveDeletedEv',
    'vlSave','dtqSave'
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
// CLOUD SYNC
// ════════════════════════════════════════════════════
function debouncedCloudSync() {
  if (!fbUser) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(pushToCloud, 2000);
}

function getAllLocalData() {
  var data = {};
  SYNC_KEYS.forEach(function(key) {
    var val = localStorage.getItem(key);
    if (val) data[key] = val;
  });
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.startsWith('fos_checks_')) data[k] = localStorage.getItem(k);
  }
  return data;
}

function pushToCloud() {
  if (!fbUser || isSyncing) return;
  isSyncing = true;

  var data = getAllLocalData();
  data._updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  data._email = fbUser.email;

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

      Object.keys(cloudData).forEach(function(key) {
        if (key.startsWith('_')) return;
        var localVal = localStorage.getItem(key);

        if (!localVal || localVal === '{}' || localVal === '[]' || localVal === 'null') {
          localStorage.setItem(key, cloudData[key]);
          localUpdated = true;
        } else if (key === 'vbd_v4') {
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
            if (localUpdated) localStorage.setItem(key, JSON.stringify(localDB));
          } catch (e) {
            console.warn('[Sync] Merge error for vbd_v4:', e);
          }
        }
      });

      lastSyncTime = Date.now();
      updateSyncUI();

      if (localUpdated) {
        console.log('[Sync] Merged cloud data into local — re-rendering (no reload)');
        // NO auto-reload — this was causing infinite loops.
        // Just re-render the app with the merged data.
        try {
          if (typeof window.DB !== 'undefined') {
            window.DB = JSON.parse(localStorage.getItem('vbd_v4') || 'null') || window.DB;
          }
          if (typeof window.updateAll === 'function') window.updateAll();
          if (typeof window.renderCB === 'function') window.renderCB();
          if (typeof window.renderProgress === 'function') window.renderProgress();
          showSyncNotice('☁️ Synced from cloud');
        } catch (e) {
          console.warn('[Sync] Re-render after merge failed:', e);
        }
      } else {
        console.log('[Sync] Local data is current');
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
// BACKUP / RESTORE
// ════════════════════════════════════════════════════
function downloadBackup() {
  var data = {};
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key) {
      try { data[key] = JSON.parse(localStorage.getItem(key)); }
      catch (e) { data[key] = localStorage.getItem(key); }
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
// AUTO-INIT — only one path fires
// ════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebaseSync);
} else {
  setTimeout(initFirebaseSync, 300);
}
