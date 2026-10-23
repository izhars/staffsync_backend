// verify-notifications.js
//
// Runnable check for the notification pipeline. No DB, no network, no test
// framework — just node:assert. Run:  node verify-notifications.js
//
// Covers:
//   1. FCM payload shape (background/killed delivery contract)
//   2. Token normalisation / multi-device handling
//   3. Socket emit room targeting
//   4. Every notification helper module loads and exports what callers import
//   5. Business-event triggers are actually wired at their call sites

require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

console.log('\n=== 1. FCM payload (background/killed delivery) ===');
const svc = require('./src/firebase/notificationService');
const buildFcmMessage = svc._buildFcmMessage || svc.buildFcmMessage;

check('non-call push carries an Android notification block', () => {
  const msg = buildFcmMessage({
    tokens: ['t1'],
    title: 'Leave Approved',
    body: 'Your leave was approved',
    data: { type: 'leave' },
  });
  assert.ok(msg.android?.notification, 'android.notification missing (data-only push)');
  assert.strictEqual(msg.android.notification.title, 'Leave Approved');
  assert.strictEqual(msg.android.notification.body, 'Your leave was approved');
  assert.ok(msg.android.priority === 'high', 'android priority should be high');
});

check('non-call push carries an APNs alert (not a silent background push)', () => {
  const msg = buildFcmMessage({
    tokens: ['t1'],
    title: 'Payroll',
    body: 'Payslip ready',
    data: { type: 'payroll' },
  });
  assert.strictEqual(msg.apns.headers['apns-push-type'], 'alert');
  assert.ok(msg.apns.payload.aps.alert, 'aps.alert missing (iOS would show nothing)');
  assert.strictEqual(msg.apns.payload.aps.alert.title, 'Payroll');
});

check('incoming call uses the ringtone channel and time-sensitive APNs', () => {
  const msg = buildFcmMessage({
    tokens: ['t1'],
    title: 'Incoming Call',
    body: 'Someone is calling you',
    data: { type: 'incoming_call', callId: 'abc' },
  });
  assert.strictEqual(msg.android.notification.channelId, 'staffsync_calls');
  assert.strictEqual(msg.apns.headers['apns-priority'], '10');
  assert.strictEqual(msg.apns.payload.aps.category, 'INCOMING_CALL');
  assert.strictEqual(msg.apns.payload.aps.interruptionLevel, 'time-sensitive');
});

check('data payload is flattened to strings and keeps title/body', () => {
  const msg = buildFcmMessage({
    tokens: ['t1'],
    title: 'T',
    body: 'B',
    data: { type: 'task', nested: { a: 1 }, n: 5 },
  });
  assert.strictEqual(msg.data.title, 'T');
  assert.strictEqual(msg.data.body, 'B');
  assert.strictEqual(typeof msg.data.nested, 'string', 'objects must be JSON strings');
  assert.strictEqual(msg.data.n, '5', 'numbers must be strings');
});

console.log('\n=== 2. FCM token handling ===');
check('schema declares fcmToken as an array', () => {
  const User = require('./src/models/User');
  const p = User.schema.path('fcmToken');
  assert.ok(p, 'fcmToken path missing');
  assert.ok(p.instance === 'Array', `expected Array, got ${p.instance}`);
});

check('socketIds is a subdocument array (not a string list)', () => {
  const User = require('./src/models/User');
  const p = User.schema.path('socketIds');
  assert.ok(p.instance === 'Array');
  assert.ok(p.schema || p.caster, 'socketIds should have a subdocument schema');
});

check('$pull on fcmToken is now legal (array field)', () => {
  const User = require('./src/models/User');
  const p = User.schema.path('fcmToken');
  // $pull only works against arrays; previously this was a String and threw.
  assert.strictEqual(p.instance, 'Array');
});

check('invalid-token cleanup uses $pull (not a schema-breaking write)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'src/firebase/notificationService.js'),
    'utf8'
  );
  assert.ok(
    src.includes('$pull: { fcmToken:'),
    'expected $pull cleanup against the fcmToken array'
  );
});

console.log('\n=== 3. Socket emit targeting ===');
const { createNotificationSender } = require('./src/socket/notification');

function fakeNamespace(roomsWithSockets) {
  const rooms = new Map(
    Object.entries(roomsWithSockets).map(([r, n]) => [r, new Set(Array.from({ length: n }, (_, i) => `s${r}${i}`))])
  );
  const emitted = [];
  const nsp = {
    adapter: { rooms },
    to(room) {
      this._targets = this._targets || [];
      this._targets.push(room);
      return this;
    },
    emit(event, payload) {
      emitted.push({ event, payload, targets: this._targets || [] });
      this._targets = [];
      return this;
    },
    _emitted: emitted,
  };
  return nsp;
}

check('emits notification:new to each recipient user room', () => {
  const nsp = fakeNamespace({ 'user:a': 1, 'user:b': 2 });
  const send = createNotificationSender(nsp);
  const report = send({ userIds: ['a', 'b'], notification: { _id: 'n1' } });

  assert.strictEqual(report.delivered, true);
  assert.deepStrictEqual(report.rooms, ['user:a', 'user:b']);
  assert.strictEqual(report.listenerTotal, 3, 'should count 1 + 2 listeners');
  assert.strictEqual(nsp._emitted.length, 1, 'exactly one emit (no duplicate delivery)');
  assert.strictEqual(nsp._emitted[0].event, 'notification:new');
});

check('role targeting uses role:<role> rooms', () => {
  const nsp = fakeNamespace({ 'role:hr_admin': 4 });
  const send = createNotificationSender(nsp);
  const report = send({ roles: ['hr_admin'], notification: {} });
  assert.deepStrictEqual(report.rooms, ['role:hr_admin']);
  assert.strictEqual(report.listenerTotal, 4);
});

check('no recipients == broadcast to the `all` room', () => {
  const nsp = fakeNamespace({ all: 7 });
  const send = createNotificationSender(nsp);
  const report = send({ notification: {} });
  assert.strictEqual(report.broadcast, true);
  assert.deepStrictEqual(report.rooms, ['all']);
  assert.strictEqual(report.listenerTotal, 7);
});

check('uninitialised namespace fails soft with a reason', () => {
  const send = createNotificationSender(null);
  const report = send({ userIds: ['a'], notification: {} });
  assert.strictEqual(report.delivered, false);
  assert.ok(report.reason, 'should explain why nothing was delivered');
});

check('a throwing emitter is reported, not rethrown', () => {
  const nsp = {
    adapter: { rooms: new Map() },
    to() { throw new Error('boom'); },
    emit() {},
  };
  const send = createNotificationSender(nsp);
  const report = send({ userIds: ['a'], notification: {} });
  assert.strictEqual(report.delivered, false);
  assert.match(report.reason, /boom/);
});

console.log('\n=== 4. Helper modules load and export ===');
check('attendanceNotifications exports every function callers import', () => {
  const m = require('./src/utils/attendanceNotifications');
  for (const fn of [
    'onPunchIn', 'onPunchOut', 'sendReminders',
    'notifyPunchInSuccess', 'notifyPunchOutSuccess',
    'notifyMorningPunchIn', 'notifyMorningPunchOut',
    'notifyEveningPunchIn', 'notifyEveningPunchOut',
    'notifyMissedCheckout', 'notifyMarkedAbsent', 'notifyLateArrival',
    'notifyShortAttendance', 'notifyRegularisationUpdate', 'notifyAttendanceExceptions',
  ]) {
    assert.strictEqual(typeof m[fn], 'function', `${fn} is not a function`);
  }
});

check('attendanceNotifications no longer requires itself', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'src/utils/attendanceNotifications.js'), 'utf8');
  // Strip comments first: the file documents the old bug in a comment.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !/require\(['"]\.\.\/utils\/attendanceNotifications['"]\)/.test(code),
    'self-require is back — every helper will be undefined again'
  );
});

check('securityNotifications exports its helpers', () => {
  const m = require('./src/utils/securityNotifications');
  for (const fn of ['notifySecurityEvent', 'recordSecurityEvent', 'notifyPasswordChanged', 'notifyDeviceReset', 'notifyVerificationChanged']) {
    assert.strictEqual(typeof m[fn], 'function', `${fn} is not a function`);
  }
});

check('notify.js exports the resilient wrappers', () => {
  const m = require('./src/utils/notify');
  for (const fn of ['notifyUser', 'notifyUsers', 'notifyInBackground']) {
    assert.strictEqual(typeof m[fn], 'function', `${fn} is not a function`);
  }
});

check('obsolete attendanceScheduler.js is gone', () => {
  assert.ok(
    !fs.existsSync(path.join(__dirname, 'src/utils/attendanceScheduler.js')),
    'attendanceScheduler.js still present (imports a deleted service)'
  );
});

console.log('\n=== 5. Trigger wiring at call sites ===');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

check('req.io is bridged from app settings for controllers', () => {
  const src = read('src/app.js');
  assert.ok(/req\.io\s*=\s*app\.get\('io'\)/.test(src), 'req.io bridge missing in app.js');
});

check('notification service requires the correct socket module', () => {
  const src = read('src/firebase/notificationService.js');
  assert.ok(
    src.includes("require('../socket/notification')"),
    'socket module path wrong (../socket/notifications does not exist)'
  );
  assert.ok(
    !src.includes("require('../socket/notifications')"),
    'old broken plural path still present'
  );
});

check('online-skip keys off isOnline, not the unused socketIds array', () => {
  const src = read('src/firebase/notificationService.js');
  assert.ok(/u\.isOnline === true/.test(src), 'skipOnlineUsers should test isOnline');
});

check('startup resets stale presence so online users are not muted', () => {
  const src = read('src/startup.js');
  assert.ok(/isOnline:\s*false/.test(src), 'boot-time presence reset missing');
});

check('FCM token refresh endpoint exists and is routed', () => {
  assert.ok(/exports\.updateFcmToken/.test(read('src/controllers/authController.js')));
  assert.ok(/fcm-token/.test(read('src/routes/authRoutes.js')), 'route not registered');
});

check('logout clears the device push token', () => {
  const src = read('src/controllers/authController.js');
  assert.ok(
    /\$pull\s*=\s*\{\s*fcmToken/.test(src),
    'logout does not remove the token ($pull on fcmToken missing)'
  );
});

check('attendance punch endpoints fire notifications', () => {
  const src = read('src/controllers/attendanceController.js');
  assert.ok(/onPunchIn\(/.test(src), 'punch-in notification not called');
  assert.ok(/onPunchOut\(/.test(src), 'punch-out notification not called');
});

check('leave triggers are wired (applied/approved/rejected/cancelled)', () => {
  const src = read('src/controllers/leaveController.js');
  // The leave flow notifies through the shared role/user helper rather than
  // the utils/leaveNotifications.js wrappers.
  assert.ok(/sendRoleBasedNotification/.test(src), 'leave controller notifies no one');
  assert.ok(/New Leave Application/.test(src), 'leave-applied notification missing');
  assert.ok(/Leave (Approved|Application Approved)/i.test(src), 'leave-approved notification missing');
  assert.ok(/Leave (Rejected|Application Rejected)/i.test(src), 'leave-rejected notification missing');
  assert.ok(/Cancel/i.test(src) && /sendRoleBasedNotification/.test(src), 'leave-cancelled path not notified');
});

check('security events are wired in auth flows', () => {
  const src = read('src/controllers/authController.js');
  assert.ok(/notifyPasswordChanged/.test(src), 'password-change notice missing');
  assert.ok(/notifyDeviceReset/.test(src), 'device-reset notice missing');
  assert.ok(/new_device_login|notifySecurityEvent/.test(src), 'new-device login notice missing');
});

check('no module still imports the deleted notification service', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const txt = fs.readFileSync(full, 'utf8');
        if (/require\(['"][^'"]*services\/notificationService['"]\)/.test(txt)) {
          offenders.push(path.relative(__dirname, full));
        }
      }
    }
  };
  walk(path.join(__dirname, 'src'));
  assert.deepStrictEqual(offenders, [], `stale imports in: ${offenders.join(', ')}`);
});

console.log('\n=== 6. Notification type contract ===');
check('every emitted notification type is allowed by the Notification enum', () => {
  const Notification = require('./src/models/Notification');
  const allowed = new Set(Notification.schema.path('type').enumValues);

  // Collect `type: 'x'` literals from the notification helper modules.
  const emitted = new Map();
  const utilsDir = path.join(__dirname, 'src/utils');
  for (const f of fs.readdirSync(utilsDir)) {
    if (!/Notifications\.js$/.test(f)) continue;
    const txt = fs.readFileSync(path.join(utilsDir, f), 'utf8');
    for (const m of txt.matchAll(/type:\s*'([a-z_]+)'/g)) {
      if (!emitted.has(m[1])) emitted.set(m[1], f);
    }
  }

  const invalid = [...emitted.entries()].filter(([t]) => !allowed.has(t));
  assert.deepStrictEqual(
    invalid.map(([t, f]) => `${t} (in ${f})`),
    [],
    'these types would throw a Mongoose ValidationError on insert'
  );
});

check('every type with a preference key has a matching User setting', () => {
  const User = require('./src/models/User');
  const settings = User.schema.path('notificationSettings').schema.paths;
  const svcSrc = read('src/firebase/notificationService.js');

  const block = svcSrc.match(/TYPE_TO_SETTING_MAP = Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(block, 'TYPE_TO_SETTING_MAP not found');

  const missing = [];
  for (const m of block[1].matchAll(/:\s*'([A-Za-z]+)'/g)) {
    if (!settings[m[1]]) missing.push(m[1]);
  }
  assert.deepStrictEqual(missing, [], `no such notificationSettings key: ${missing.join(', ')}`);
});

check('DOMAIN senders actually push (not just insert)', () => {
  const src = read('src/firebase/notificationService.js');
  const fn = src.slice(src.indexOf('async function sendRoleBasedNotification'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.ok(
    /sendFcmToUsers|socketSvc\.sendNotification/.test(body),
    'sendRoleBasedNotification inserts rows but never delivers them'
  );
});

// ── summary ───────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}`);
console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`  FAILED:`);
  failed.forEach((f) => console.log(`    - ${f.name}: ${f.err}`));
}
console.log(`${'='.repeat(60)}\n`);
process.exit(failed.length ? 1 : 0);
