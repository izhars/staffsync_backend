# StaffSync backend — code audit

Read-only audit of `staffsync-backend` (Node 18+/Express 4/Mongoose 8/Socket.IO).
Every finding below was verified by reading the cited code; the highest-impact ones were
additionally cross-checked empirically (module resolution scan, `moment-timezone` behaviour,
live model schemas) — see "How this was verified".

Scope: `src/**` (~190 files), root scripts, route wiring, dependency state. No files were modified.

Severity legend: **CRITICAL** = money/access/data loss, exploitable now · **HIGH** = real
breakage or privilege gap · **MEDIUM** = correctness/robustness · **LOW/INFO** = hygiene.

---

## 0. Fix order — highest impact first

Severity ordering here is by **impact × exploitability**, not by category: an unauthenticated
endpoint or a one-line crash outweighs a subtle correctness bug.

### 0.1 The complete list of endpoints with no authentication

Every path below was read and confirmed to have no `protect`/auth middleware. Mount prefixes come
from `src/routes/index.js`.

| Method + path | Where | What an anonymous caller gets |
|---|---|---|
| `GET /api/test-connection` | `src/app.js:50` | liveness (intentional) |
| `GET /reset-password/:token` | `src/app.js:42` | static reset page |
| `GET /uploads/*` | `src/app.js:39` | **any uploaded document**, incl. the one committed to git |
| `POST /api/cron/test/auto-checkout` | `cronTestRoutes.js:7` | 500 (task does not exist) |
| `POST /api/cron/test/mark-absent` | `cronTestRoutes.js:8` | 500 (task does not exist) |
| `POST /api/cron/test/birthday-wishes` | `cronTestRoutes.js:9` | **runs the real company-wide email job** |
| `GET /api/cron/test/pending-checkouts` | `cronTestRoutes.js:12` | today's attendance + emails |
| `GET /api/cron/test/today-attendance` | `cronTestRoutes.js:13` | today's attendance + emails |
| `GET /api/debug/connections` | `debugRoutes.js:11` | connection debug data |
| `GET /api/debug/connections/:userId` | `debugRoutes.js:27` | per-user IP / user-agent / socket history |
| `GET /api/debug/online-users` | `debugRoutes.js:45` | full online roster (names, roles, departments) |
| `GET /api/debug/online-status/:userId` | `debugRoutes.js:64` | presence of any user |
| `GET /api/debug/socket-status` | `debugRoutes.js:83` | roster + internals (advertised in the boot banner) |
| `GET /api/debug/test-connection` | `debugRoutes.js:120` | liveness |
| `POST /api/geocode/route` | `geocode.js:7` | burns the server's Ola Maps key |
| `GET /api/plate/` | `numberPlateRoutes.js:8` | proxies a third party over plain HTTP |
| `GET /api/plate/test`, `/health` | `numberPlateRoutes.js:80, 122` | upstream probe + target address |
| `POST /api/rfid-scans/` | `rfidRoutes.js:16` | **anonymous file upload** (5 files/request) |
| `GET /api/rfid-scans/recent`, `/grouped/date`, `/lane/:id`, `/lane-stats`, `/media-only` | `rfidRoutes.js:23-34` | every gate/vehicle scan + images |
| `DELETE /api/rfid-scans/:id` | `rfidRoutes.js:36` | destroy any scan |
| `GET /api/system/`, `/health` | `systemRoutes.js:6, 16` | internals |
| `GET /api/system/send-test-notification?userId=` | `systemRoutes.js:26` | **push an arbitrary FCM notification to any user** |
| `POST /api/test_notifications/test` | `notifications.test.js:7` | **company-wide notification + FCM blast** |
| `GET /api/test_notifications/check-fcm/:userId` | `notifications.test.js:62` | name, role, active/online state, FCM token prefix |
| `GET /api/faqs/`, `/api/faqs/search`, `/api/about/` | `faqRoutes.js:21-22`, `aboutRoutes.js:25` | public by design |

Unreachable but dangerous: `src/routes/faceRecognitionRoutes.js` is **not mounted** anywhere, so its
`/api/face/health` and the biometric store it implies are dead code today.

### 0.2 Ranked work list

| # | Issue | Where |
|---|-------|-------|
| 1 | Broken `require` path kills **all** realtime notification delivery (`../socket/notifications` → file is `notification.js`) | `src/firebase/notificationService.js:686` |
| 2 | Any logged-in user can **kill the server process** (un-awaited `Conversation.findById`) | `src/socket/chat.js:960` |
| 3 | **`PUT /api/auth/profile` accepts `password`** — any valid JWT silently takes over the account | `src/controllers/authController.js:524-544, 568` |
| 4 | Payroll **crashes** (`ReferenceError: employedDays`) whenever per-minute late penalty applies | `src/controllers/payrollController.js:274` |
| 5 | Proration divides payable days by **full calendar days** → mid-month hires paid ~half | `src/controllers/payrollController.js:210-213` |
| 6 | Unauthenticated endpoints: mark everyone absent / auto-checkout / mass email / RFID writes / debug PII | `src/routes/cronTestRoutes.js`, `debugRoutes.js`, `notifications.test.js`, `systemRoutes.js`, `rfidRoutes.js` |
| 7 | Queries on fields that don't exist (`ComboOff.date`, `Leave.fromDate/toDate`, `Attendance.leave/notes/overtimeHours`, `RestrictedHolidayUsage.leave`) — Mongoose strict mode silently returns nothing | attendance/leave/combo-off paths |
| 8 | Attendance punch notifications are dead — the module **requires itself** | `src/utils/attendanceNotifications.js:8` |
| 9 | Half-day leave writes an **invalid status** no reader understands → day scored absent (unpaid) | `src/services/leaveService.js:198-224` |
| 10 | Face/biometric verification is **client-asserted** (embedding + liveness flag come from the request body) | `src/controllers/faceController.js:42-96` |
| 11 | HR role checks compare `'hr'`/`'admin'`, which are **not** in the role enum → HR locked out / safeguards dead | `expenseController.js:416`, `payrollController.js:424`, `taskController.js:13,30`, `punchVerification.js:21` |
| 12 | Legacy JWTs without `sessionId` **bypass** single-session enforcement forever | `src/middleware/auth.js:60` |
| 13 | `updateEmployee` / `createEmployee` / `updatePayroll` / `updateTask` / `poll.edit` / `updateRole` / `updateHoliday` merge raw `req.body` → privilege escalation, salary self-inflation | multiple |
| 14 | `x-forwarded-for` is trusted → office-IP gate and rate limits bypassable with one header | `src/app.js:16`, `src/utils/punchVerification.js:30-42` |
| 15 | `GET /api/tokens` returns **raw bearer JWTs** for every user to any HR admin | `src/controllers/tokenController.js:8-16` |

---

## 1. CRITICAL — money and access

### 1.1 Realtime notifications are dead: `require` path points at a deleted file
- **Where:** `src/firebase/notificationService.js:686`
- **Code:** `const socketSvc = require('../socket/notifications');`
- **Why:** The file on disk is `src/socket/notification.js` (singular). A resolution scan of every
  relative `require` in `src/**` flags exactly this. The throw is swallowed by the surrounding
  `catch (err) { console.warn('[notif/socket] emit failed:', err.message); }` (line 710), so
  **every** notification silently skips socket delivery while the API still reports success.
  This is a regression from the deleted `src/services/notificationService.js` refactor
  (`git status` shows `D src/services/notificationService.js`).
- **Fix:** `require('../socket/notification')`, and make the catch rethrow (or log at error level).

### 1.2 Payroll generation crashes on late penalty
- **Where:** `src/controllers/payrollController.js:271-276`
- **Code:**
  ```js
  if (latePenalty === 'deduct-minutes' && summary.totalLateMinutes > 0) {
    const perMinute = lateDeductionPerMinute > 0
      ? lateDeductionPerMinute
      : (earnedBasic / (employedDays * 8 * 60));   // ← employedDays is undefined
  ```
- **Why:** `employedDays` exists only as `summary.employedDays` (used correctly at line 219 with the
  comment `(audit only)`). Any month with a late employee and no explicit per-minute rate throws,
  the handler returns 500, and the payroll run aborts partway.
- **Fix:** `summary.employedDays || 1` (or `calendarDays`).

### 1.3 Proration denominator is wrong → mid-month hires underpaid
- **Where:** `src/controllers/payrollController.js:210-224`
- **Code:**
  ```js
  const calendarDays = summary.calendarDays || 30;
  const ratio = calendarDays > 0 ? round2(summary.payableDays / calendarDays) : 0;
  const earned = (base) => round2((base || 0) * ratio);
  ```
- **Why:** `buildMonthMap` produces one entry per **calendar** day, and marks pre-joining /
  post-leaving days `payableFraction: 0, skip: true` (`src/services/attendanceResolver.js:190-205`).
  `payableDays` therefore already excludes those days, but the denominator still counts them.
  Example: joining on the 16th of a 31-day month → 16 payable days / 31 ≈ **0.52** instead of 16/16.
  The employment-aware denominator (`employedDays`) is computed and logged but not used.
- **Fix:** divide by `summary.employedDays` (days actually inside the employment window).

### 1.4 Unauthenticated state-changing and data-exposing routes
- **Where:** `src/routes/cronTestRoutes.js:7-13` (mounted as `/api/cron` in `src/routes/index.js:27`)
- **Code:**
  ```js
  router.post('/test/auto-checkout', cronTestController.testAutoCheckout);
  router.post('/test/mark-absent', cronTestController.testMarkAbsent);
  router.post('/test/birthday-wishes', cronTestController.testBirthdayWishes);
  router.get('/test/pending-checkouts', cronTestController.getPendingCheckouts);
  router.get('/test/today-attendance', cronTestController.getTodayAttendance);
  ```
- **Why:** No `protect` anywhere in the file, and the controller adds none
  (`src/controllers/cronTestController.js`). Anyone who can reach the port can mark the entire
  company absent, force auto-checkout, trigger company-wide email, and dump today's attendance.
  Companion gaps, all confirmed to lack auth middleware:
  `src/routes/debugRoutes.js` (`/api/debug/*`: online users, per-user connection debug),
  `src/routes/systemRoutes.js` (`GET /api/system/send-test-notification?userId=` pushes to any user),
  `src/routes/notifications.test.js` (`POST /api/test_notifications/test` — writes notifications,
  reads `req.user` from an unauthenticated request; `GET /check-fcm/:userId` leaks name/role/FCM
  token prefixes), `src/routes/numberPlateRoutes.js` (`/api/plate` — unauthenticated proxy to an
  external vehicle-registration service), `src/routes/geocode.js` (unauthenticated proxy burning
  the Ola Maps quota with the server-side key).
- **Fix:** delete the test/debug routers from `routes/index.js`, or gate them behind
  `protect` + `superAdminOnly` and an explicit `NODE_ENV !== 'production'` check.

### 1.5 Field-name drift: queries filter on fields that do not exist
Mongoose strict mode silently ignores unknown **query** paths — no error, no match.

| Query | Model actually has | Effect |
|---|---|---|
| `ComboOff.findOne({ date: {...} })` — `attendanceController.js:176, 190, 1464`, `find` at `861, 1188, 1930, 2219, 2433, 2845` | `workDate` (`src/models/ComboOff.js:10`) | Approved combo-offs are **never found** → weekend/holiday check-in always rejected; combo-off days render absent |
| `Leave.find({ fromDate, toDate })` — `attendanceController.js:867, 1194, 1935, 2212, 2426, 2849` | `startDate`/`endDate` (`src/models/Leave.js:30-31`) | Approved leave invisible in employee/today/all attendance views and the monthly Excel export → staff on leave reported **absent** |
| `Attendance.deleteMany({ leave: leave._id })` — `leaveController.js:266-278` | no `leave` field (`src/models/Attendance.js`) | Cancelling leave deletes nothing; `on-leave` rows persist |
| `attendance.notes = ...` — `attendanceController.js:1616` | `remarks` | Notes silently discarded while API returns success |
| `record.overtimeHours` — `attendanceController.js:2994-2996` | absent | Excel "Overtime Hours" always 0 |
| `RestrictedHolidayUsage` written with `leave: leaveId`, then `deleteMany({ employee, leave })` — `leaveService.js:171-192` | no `leave`, **unique index** `{employee, holiday}` (`models/RestrictedHolidayUsage.js:24`) | Reject/cancel never releases quota, and the live unique index permanently blocks re-applying; the 11000 duplicate is swallowed (`leaveService.js:180-184`) so callers see success |

`attendanceResolver.js` gets these right (`workDate` at :109, `startDate/endDate` at :102-103) —
the bug is confined to `attendanceController.js` / `leaveService.js`.

### 1.6 Half-day leave is written as a status nobody reads → unpaid
- **Where:** `src/services/leaveService.js:198-224`
- **Code:** `? ATTENDANCE_STATUS.HALF_FIRST : ATTENDANCE_STATUS.HALF_SECOND` →
  `'half-day-first'` / `'half-day-second'` (`src/constants/leave.js:27-28`), then
  `Attendance.bulkWrite(ops, { ordered: false })` with `upsert: true`.
- **Why:** `Attendance.status` enum is
  `present | absent | half-day | on-leave | public-holiday | combo-off | non-working-day`
  (`src/models/Attendance.js:180-192`) — the written values are **not** in it. Bulk-write
  `updateOne` skips validation, so the rows land. `buildMonthMap` only recognises `'half-day'`
  (`src/services/attendanceResolver.js:264`), falls through every branch, and leaves
  `payableFraction: 0` → the employee is treated as absent and loses the day's pay.
- **Fix:** write `'half-day'` (store which half in a dedicated field), and add the values to the enum.

### 1.7 Role strings that never match the enum
`User.role` enum is exactly `['superadmin','hr_admin','manager','team_lead','employee']`
(`src/constants/roles.js:3-9`, verified against the live schema).

- `src/controllers/expenseController.js:416` — `req.user.roles && (…includes('hr') || …includes('admin'))`
  — `roles` (plural) is **never set** by `protect` (`src/middleware/auth.js:89` assigns `req.user = user`),
  and the strings don't match anyway. `isHR` is permanently false → HR gets 403 on others' expenses;
  the "HR sees only submitted" branch at :425 is dead code.
- `src/controllers/payrollController.js:424` — `['hr','admin'].includes(req.user.role)` → always false,
  so HR cannot fetch another employee's payslip.
- `src/controllers/taskController.js:13` and `:30` — `'hr'` checks fail, so HR admins are treated
  as regular users for task visibility and management. Line 14 also reads `assignee.managerId`,
  which is not a field on `User` (it is `reportingManager`) → the manager branch never matches.
- `src/utils/punchVerification.js:21` — `const PRIVILEGED_ROLES = ['hr','admin'];` never matches, so
  HR/superadmin are not recognised as privileged in the face/geo-fence bypass logic.

### 1.8 Legacy JWTs bypass single-session enforcement permanently
- **Where:** `src/middleware/auth.js:60`
- **Code:** `if (decoded.sessionId && user.currentSessionId !== decoded.sessionId) { …401… }`
- **Why:** A token minted before the `sessionId` feature has no `sessionId` claim, so the guard is
  skipped entirely and that token stays valid for its full 30-day life — through HR device resets
  (`resetDevice` sets `currentSessionId = null`) and new logins. Combined with `JWT_SECRET` still
  being the placeholder value (see 1.10), a leaked token is effectively permanent.
- **Fix:** treat a missing `sessionId` as invalid (or keep an explicit `legacyTokensAllowedUntil` cutoff).

### 1.9 Mass assignment on privileged update paths
- **Where:** `src/controllers/employeeController.js:312-316`
  ```js
  const updatedEmployee = await User.findByIdAndUpdate(
    req.params.id, req.body, { new: true, runValidators: true }
  ).populate('department reportingManager');
  ```
  Route guard is only `hrAdminAndAbove` (`src/routes/employeeRoutes.js:34`). `req.body` is passed
  through untouched (only `password` is deleted), so an HR admin can set `role: 'superadmin'`,
  rewrite `salary`, `bankDetails`, `employeeId`, `currentSessionId`, or deactivate anyone.
  Contrast with `register` (`authController.js:66-77`), which **does** enforce `ROLE_CREATION_MATRIX`.
- **Where:** `src/controllers/payrollController.js:486-492`
  ```js
  payroll[key] = { ...payroll[key].toObject(), ...req.body[key] };
  ```
  for `earnings`/`deductions`/`attendance`/`status` with no allow-list and no numeric sanity
  checks → `basicSalary: 9999999`. `models/Payroll.js:153` does not clamp a negative net.
- **Also:** `src/controllers/expenseController.js:130-140` (update path) spreads `req.body` over the
  document, letting an employee set `status:'approved'`, `approvedBy`, `amount`. The `maxAmount`
  check at :32 compares a **string** `req.body.amount` with a Number, so `"5000" > 2000` is false
  and the category cap is bypassable.
- **Fix:** explicit field allow-lists (like `updateProfile`'s `forbiddenFields` at
  `authController.js:524-544`), `Number()` casts, and re-check limits on update.

### 1.10 Secrets and identity material in the working tree
- `.env` is gitignored and was **never committed** (verified with `git log --all -- .env`), which is
  correct. But the live values are weak/leaky:
  `JWT_SECRET=your_super_secret_jwt_key_change_in_production` (the placeholder, still in use),
  `MONGODB_URI` with **no database name** (defaults to the `test` database), a fine-grained
  `GITHUB_TOKEN` with repo write access, plus Cloudinary/Firebase/Agora/Ola keys in plaintext.
- `google-services.json` **is tracked** and contains the Firebase API key
  (`AIzaSyDC_fzkSMHWhJL8idjRIBGFvzslg_YQWt4`) — expected for a client config, but confirm that key is
  restricted by app/bundle ID.
- Hardcoded seed credentials in tracked code: `seedAdmin.js:29` (`StaffSync@123`),
  `src/seed/seedEmployee.js:22` (`Scaipl@123`) — and `createSuperAdmin()` runs on **every boot**
  (`src/startup.js:19`).
- `src/config/google-credentials.json` exists on disk (gitignored — fine).
- **Fix:** rotate the JWT secret, name the database explicitly, move seed passwords to env vars.

### 1.11 Any authenticated user can kill the server process (remote DoS)
- **Where:** `src/socket/chat.js:960`
- **Code:**
  ```js
  socket.on('group-typing-start', ({ groupId }) => {
      const sender = socket.user;
      const group = Conversation.findById(groupId);   // ← not awaited
      if (group) {                                     // Query object: always truthy
          group.participants.forEach(participant => {   // ← TypeError
  ```
- **Why:** `Conversation.findById()` returns a Query, so `group` is truthy and
  `group.participants` is `undefined`. The `TypeError` is thrown synchronously inside a
  Socket.IO event handler with no try/catch, so it surfaces as an `uncaughtException`;
  `src/server.js:93-96` responds to that by running the graceful-shutdown path and calling
  `process.exit(1)`. **One socket message from any authenticated user takes the whole backend
  down.** There is no membership check either, and `group-typing-stop` (`:980-1001`) has the same
  shape.
- **Fix:** `await`, plus a membership check; wrap every socket handler in try/catch (or a
  `safeHandler` wrapper) so a handler throw can never reach `uncaughtException`.

### 1.12 Biometric/face verification is entirely client-asserted
- **Where:** `src/controllers/faceController.js:42-96`,
  `src/controllers/attendanceController.js:50, 103-108, 487-492`, `src/services/googleVisionService.js:521-544`
- **Code:**
  ```js
  const { embedding, model = 'mobilefacenet', livenessPassed = false, … } = req.body;
  …
  if (!livenessPassed) { … }              // client says whether it passed
  const normalized = l2Normalize(embedding);   // client-supplied vector
  ```
  and the "similarity" used for the comparison is built from pose angles, bounding-box geometry
  and **unnormalized pixel landmark distances**:
  `const matched = similarity > 0.6 && confidence > 0.3;`
- **Why:** The server never computes an embedding and never performs liveness — it accepts the
  vector and the liveness boolean from the request body. An employee can enroll a constant vector
  and replay it on every punch, so the face factor authenticates nothing. Worse, the underlying
  comparator is not identity matching at all: Google Vision `FACE_DETECTION` returns geometry, and
  two different people in a similar pose can exceed the 0.75 acceptance threshold. Treat
  face-based attendance as non-functional for security purposes.
- **Fix:** Server-side liveness + embedding extraction from an uploaded frame, templates stored and
  never accepted from clients, and a real 1:1 recognition model (ArcFace/FaceNet-class) with a
  FAR/FRR-tuned threshold. Until then, do not treat a face check as a control.

### 1.13 Password/credential handling: profile takeover, brute-force oracle, dead lockout
- **`PUT /api/auth/profile` sets the password without the current password.** `forbiddenFields`
  (`authController.js:524-541`) omits `password`, and `Object.assign(user, updates)` (`:568`)
  writes it; the `pre('save')` hook then hashes and persists it. `PUT /api/auth/change-password`
  requires `currentPassword`, but this route does not, and `validateUpdateProfile`
  (`src/validators/authValidator.js:81`) is exported and **never wired** to the route
  (`src/routes/authRoutes.js:46`). Anyone holding a valid token — including a borrowed device or a
  token read from `GET /api/tokens` — can set a new password and lock the owner out.
- **Account lockout and security logging do not exist.** `authController.js:969, 986-987, 1002-1013,
  1042-1057` update `loginAttempts`, `accountStatus`, `securityLogs`, `deviceHistory` and
  `lastVerificationCheck`; none of those paths exist on the `User` schema, so strict mode strips
  them. The "lock the account after 5 device mismatches" branch is unreachable and the
  DEVICE_MISMATCH audit trail is never written. Neither `forgot-password` nor `reset-password` has
  a rate limiter (`authRoutes.js:30-31`), and `forgotPassword` still returns a distinct 404 for an
  unknown email (`authController.js:683-687`).
- **Reset tokens are predictable and stored in cleartext.** `models/User.js:576-585` builds the
  token from `Math.random()` (not a CSPRNG) and stores the raw string; `resetPassword` compares by
  equality. Use `crypto.randomBytes(32)` and store only a hash.
- **Fix:** explicit allow-list on `updateProfile` (never spread `req.body`), one shared
  password-policy validator for register/change/reset, rotate `currentSessionId` on
  password change/reset, add the missing schema fields or delete the dead lockout code, and add a
  dedicated limiter to the reset flow.

### 1.14 Privileged mass assignment — escalation and self-enrichment
Every one of these passes client input straight into a Mongoose write:

| Where | Code | Impact |
|---|---|---|
| `employeeController.js:312-316` | `User.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true })` | `hr_admin` promotes anyone (or themselves) to `superadmin`, rewrites `salary`, `bankDetails`, `isActive`. `runValidators` does not help — `'superadmin'` is a valid enum value. `DELETE` is `superAdminOnly`, so this bypasses that intent |
| `employeeController.js:259, 276` | `const employeeData = req.body; … User.create(employeeData)` | `createdBy`/`role` client-set; `ROLE_CREATION_MATRIX` is never consulted (zero call sites outside `constants/roles.js`) |
| `payrollController.js:486-492` | `payroll[key] = { …payroll[key].toObject(), …req.body[key] }` | salary inflation, negative net pay |
| `taskController.js:157` | `Object.assign(task, req.body)` | reassign tasks, forge `completedAt`, erase other users' comments |
| `pollController.js:206-210` | `Poll.findOneAndUpdate({_id, createdBy}, req.body, {new:true})` | rewrite `options[].votes`, clear `votedUsers` to re-vote, flip `isAnonymous`, reassign `createdBy` |
| `roleController.js:223, 230-246` | guard `if (role.isSystemRole)` runs **before** `Object.assign(role, req.body)` | send `isSystemRole:false` to defuse the lock, then delete the system role |
| `holidayController.js:226, 269-273` | `Holiday.findByIdAndUpdate(id, {…req.body, updatedAt})` | set `createdBy`, `_id`, `weekday` (bypassing the pre-save fixer), `isActive` |

**Fix:** explicit allow-lists everywhere (the `forbiddenFields` pattern in `updateProfile` is the
right shape, just incomplete), plus `ROLE_RANK[target] < ROLE_RANK[caller]` checks on role changes.

### 1.15 Cross-user data exposure and IDOR
- `src/controllers/callController.js:360-364` — `GET /api/calls/ongoing/:userId` reads `userId` from
  the path and never compares it to `req.user.id`, so any user can enumerate who is on a call with
  whom across the company.
- `src/controllers/tokenController.js:8-16` — `GET /api/tokens` (`hrAndAbove`) returns full `Token`
  documents including the **raw JWT**, because `middleware/auth.js:83-87` persists the token
  verbatim. A DB dump or one HR session yields live bearer credentials for every user.
  `Token.tokenType` (`models/Token.js:24`) also only allows `['employee','manager','hr','superadmin']`
  while `auth.js:80` writes `user.role` — i.e. `'hr_admin'`/`'team_lead'`, which are not in the enum.
- `src/controllers/assetController.js:40-50` — `GET /api/assets/:id` has no ownership/role check
  (only `protect`), leaking the inventory and who holds which device, plus holder email.
- `src/controllers/employeeController.js:400-419` — `PUT /api/employees/:id/profile-picture` has
  **no** role or ownership guard on either the route or the handler: any employee can replace any
  colleague's (or HR's, or the super-admin's) avatar.
- `src/controllers/geoFenceController.js:404-416` — `.select()` omits `allowedDepartments` and
  `allowedEmployees`, so the ACL check below it evaluates `noDept && noEmp` as always true and
  `GET /api/geo-fence/my-locations` returns **every** active fence to every employee. The sibling
  `src/utils/geoFence.js:81` loads the same documents without a projection and is correct — the
  duplicated logic has drifted.
- `src/services/employeeService.js:10-15, 31-34` — `select('-password')` is the only protection, so
  employee lists carry `salary{}`, `bankDetails{}`, `panNumber`, `pfNumber`, `uanNumber`,
  `documents[].fileUrl`, `faceData.images[].base64` and the live `resetPasswordToken`. `limit` is
  also uncapped.
- `src/controllers/employeeController.js:243` — the self-check compares `req.user.id` (a 24-hex
  **string**) with `employee.id` (a Mongoose virtual returning an **ObjectId**), which is never
  equal, so the guard misfires for the case it was meant to allow.
- `src/controllers/notificationController.js:382` — requires `../models/AgoraCall`, which does not
  exist (the model is `Call`), so the endpoint always 500s.

### 1.16 A user-uploaded document is committed to git, and `git.add('.')` keeps publishing
- **Where:** `uploads/77e90d96476760b91a17f31c0109a23c` (**tracked** — `git ls-files uploads`),
  `src/app.js:39`, `src/services/git.service.js:90`
- **Code:** `app.use('/uploads', express.static(path.join(__dirname, '../uploads')));` (the line above
  it even says `// Consider gating /uploads behind auth`) and `await git.add('.');`
- **Why:** `.gitignore` covers only `.env`, `node_modules/` and `google-credentials.json` — `uploads/`,
  `debug-images/` and the ngrok zip are not ignored, a real user upload is already committed, and the
  files are served with no authentication on a guessable 32-hex path that is itself public in the repo.
  `POST /api/github/push` then stages the entire working tree with `git.add('.')`, so every private
  document employees upload — and `google-services.json` — gets pushed to GitHub.
- **Fix:** ignore those paths, purge the file from history, serve documents through an authenticated
  controller instead of `express.static`, and restrict the git-push helper to an explicit path
  allow-list.

### 1.17 Real scheduled jobs are exposed unauthenticated
- **Where:** `src/routes/cronTestRoutes.js:7-13`, `src/controllers/cronTestController.js:9, 27, 45`
- **Code:** `router.post('/test/birthday-wishes', cronTestController.testBirthdayWishes);` →
  `const result = await cronTasks.sendBirthdayWishes();`
- **Why:** `sendBirthdayWishes` **is** a real job (`src/utils/cronJobs.js`), so an anonymous caller
  triggers a company-wide email/push run at will (cost, spam, reputation). The sibling endpoints are
  worse in a different way: `cronTasks.autoCheckoutEmployees` and `cronTasks.markAbsentEmployees` do
  **not exist** (the exported keys are `creditProbationCompletionLeave, generateMonthlyReport,
  notifyMorningPunchIn, notifyMorningPunchOut, notifyEveningPunchIn, notifyEveningPunchOut,
  sendBirthdayWishes, sendCelebrationNotifications`), so those two always 500 and echo the internal
  error text. `GET /test/today-attendance` and `/test/pending-checkouts` leak employee emails
  (`populate('employee','name email')` — `name` is not a User field).
- **Fix:** delete the router from `routes/index.js`, or gate it behind `protect` + `superAdminOnly`
  plus an explicit non-production check.

---

## 2. HIGH

### 2.1 Office-IP gate and rate limits are spoofable
- **Where:** `src/app.js:16` (`app.set('trust proxy', 1)`) +
  `src/utils/punchVerification.js:30-42` (`getClientIp` takes the **first** `x-forwarded-for` entry)
- **Why:** With `OFFICE_IP_WHITELIST=161.248.69.178` in `.env`, a single header
  `X-Forwarded-For: 161.248.69.178` makes `isOfficeNetwork` report `isOffice: true`, which disables
  the GPS/geo-fence requirement. The same header controls `req.ip`, so the login limiter
  (`express-rate-limit`, keyed on `req.ip`) can be defeated by rotating the header value.
- **Fix:** trust only the proxy you actually run behind (`trust proxy` = exact hop count or subnet),
  and take the **last** untrusted hop for the client IP.

### 2.2 No global rate limiting; auth limiters are in-memory
- **Where:** `src/middleware/rateLimit.js:22` defines `apiLimiter`, but a grep for `apiLimiter`
  across `src/` finds **no consumer**. Only `/login` (20/min) and `/register` (10/h) are limited.
- **Why:** Public endpoints with no limit: `/api/auth/forgot-password` (sends mail, see 2.3),
  `/api/auth/reset-password/:token`, `/api/geocode/route`, `/api/plate`, plus the unauthenticated
  routers in 1.4. Default `express-rate-limit` storage is per-process memory, so limits do not hold
  across instances.
- **Fix:** apply `apiLimiter` globally in `app.js`, tighten the login window (20/min/IP is generous),
  add per-account throttling, and use a shared store if you run more than one instance.

### 2.3 Password reset: user enumeration + no invalidation of live sessions
- **Where:** `src/controllers/authController.js:676-738`
- **Code:** `if (!user) throw new AppError('No user found with that email', 404, { code: 'USER_NOT_FOUND' });`
- **Why:** The 404/200 difference confirms whether an email is registered. Login leaks the same way
  via `ADMIN_MUST_USE_EMAIL` / `EMPLOYEE_MUST_USE_EMPLOYEE_ID` (`authController.js:325-337`).
  Additionally `resetPassword` (line 714) and `changePassword` (line 641) never touch
  `currentSessionId`, so **existing JWTs keep working after a password reset** — an attacker who
  stole a token retains access after the victim rotates their password.
- **Fix:** always return the same generic response; on password change/reset, rotate
  `currentSessionId` and drop the `Token` record.

### 2.4 Login's device binding is opt-in by the client
- **Where:** `src/controllers/authController.js:389`
- **Code:** `if (user.deviceId && deviceId && user.deviceId !== deviceId) {`
- **Why:** If a request simply omits `deviceId`, the mismatch check is skipped — the second factor
  is only enforced when the client volunteers it. `deviceId` is also a client-supplied string with
  no signature, so it can be replayed.
- **Fix:** require `deviceId` for non-admin logins, or bind sessions server-side.

### 2.5 JWT/`Token` bookkeeping writes on every authenticated request
- **Where:** `src/middleware/auth.js:83-87`
- **Why:** `Token.findOneAndUpdate({ user }, …, { upsert: true })` runs on **every** protected
  request, so pages that fire many API calls do a DB write each time. It also overwrites the stored
  token for the user, meaning one device silently replaces another's record.
- **Fix:** write the token at login/logout only.

### 2.6 `minRole` guard fails open
- **Where:** `src/middleware/auth.js:148-155`
- **Code:** `const userRank = ROLE_RANK[req.user.role] ?? 0; const requiredRank = ROLE_RANK[minRole] ?? 0;`
- **Why:** Both sides default to `0`, so an unknown role passes any unknown-role requirement; and
  unlike the equivalent helper in `constants/roles.js:89-93` (which uses `-1`/`Infinity`
  correctly), this one also ignores legacy aliases. It is currently unused, but it is a trap.
- **Fix:** delete it and use `hasRankAtLeast` from `src/constants/roles.js`.

### 2.7 `app.set('io', io)` never reaches `req.io` → forced logout never fires
- **Where:** `src/startup.js:32` sets it; `authController.js:446, 764` and
  `notificationController.js:46, 52` read **`req.io`**; no middleware ever assigns it (grep for
  `req.io =` finds nothing).
- **Why:** Login's "kick the previous device" and HR's `resetDevice` emit are no-ops. Security still
  holds (the DB `currentSessionId` check rejects the old token on the next request), but the user
  experience is broken: the old device appears logged in until it makes a request, and the
  notification controller's emit helper silently returns.

### 2.8 Half-day + full-day leave double-counts the same day
- **Where:** `src/services/leaveService.js:119-137` includes `leaveDuration` in the overlap filter
- **Why:** A full-day leave and a half-day leave on the same date do not overlap, so both can be
  approved and `totalDays` is debited twice for one calendar day, while
  `markAttendanceForLeave` writes two conflicting attendance records for it.
- **Also:** `leaveController.js:406-410` debits with `$inc` after a non-atomic read (`:380`), and
  `$inc` bypasses the schema `min: 0` (`models/User.js:222-225`) → concurrent approvals can drive a
  balance negative. `comboOffController.js:132-146` has the same read-then-`$inc` race (two
  concurrent approvals credit twice); `cronJobs.js:155-172` shares the pattern for monthly accrual.

### 2.9 Documented-but-missing authorization on expense/payroll reads
- `expenseController.js:720-739` (`getExpenseDetailForHR`) and `:742-804` (`bulkApproveExpenses`) have
  no authorization check at all. They are currently unmounted in `routes/expenseRoutes.js`, so they
  are dead code today — but they are a live hazard the moment anyone mounts them.
- `employeeController.js:400-420` — `PUT /api/employees/:id/profile-picture` has **no** role guard
  (`employeeRoutes.js:44-48`): any authenticated user can change any colleague's profile picture,
  including HR's. Straightforward impersonation/social-engineering vector.
- `employeeController.js:229-253` — `GET /api/employees/:id` only blocks role `'employee'` from
  reading others; any `manager`/`team_lead`/`hr_admin` can read any employee's full document,
  including `salary`, `bankDetails`, `panNumber`, `uanNumber` and `documents` (only `-password` is
  excluded). `getAllEmployees` (:11-60) also returns full documents for every employee to any
  `managerAndAbove` caller, with no department scoping.
- `authController.js:501-516` — `GET /api/auth/me` returns the whole user document (salary, bank,
  PAN) with `toJSON: { virtuals: true }` and no field transform (`models/User.js:346`).

### 2.10 Dependent modules referencing deleted/renamed files
A full scan of relative `require`s found three broken paths (one more is a false positive inside a doc comment):
- `src/firebase/notificationService.js:686` → `../socket/notifications` (live bug, see 1.1)
- `src/controllers/notificationController.js:382` → `../models/AgoraCall` — **no such model exists**;
  `POST /api/notifications/call/:callId` throws MODULE_NOT_FOUND before its own authorization check.
- `src/utils/attendanceScheduler.js:1` → `../services/notificationService` (deleted, shows as
  `D` in `git status`). The module currently has **no importers**, so it is dead code — and it is
  dead code that cannot be loaded.
- Related: `attendanceScheduler.js:213` references `eveningCheckIn`/`eveningCheckOut`
  (see `cronJobs.js:103,116`), fields that do not exist on `Attendance` either.

### 2.11 `xlsx` has no patched version on npm
- `npm audit --omit=dev` reports 76 advisories (9 critical) across the tree; the ones with real
  reachability here are version-pinning problems rather than live exploits.
- `xlsx@0.18.5` (prototype pollution / ReDoS, **no fix available**) is used only to **write**
  exports (`feedbackController.js:181-184`), so it is not parsing untrusted input today — keep it
  that way, and migrate to the SheetJS CDN distribution if you ever read files with it.
- `multer` is declared as `^1.4.5-lts.1` but `1.4.5-lts.2` is installed; the 1.x line is
  deprecated — plan the 2.x upgrade.
- `axios` is used by `numberPlateRoutes.js:2` but is **not declared** in `package.json`
  (`npm ls axios --depth=0` → empty). It resolves today only as a transitive dependency — a fresh
  install or a dependency bump can break that route at runtime.
- `jsonwebtoken`, `express`, `handlebars`, `simple-git`, `mongoose` all surface advisories; most
  require major bumps or are transitive through `firebase-admin`/`@google-cloud/vision`.

### 2.12 Attendance punch notifications are dead — the module requires itself
- **Where:** `src/utils/attendanceNotifications.js:8`
- **Code:** `} = require('../utils/attendanceNotifications');`
- **Why:** The file requires **itself** at its own top, so at load time the export object is still
  empty and all six destructured `notify*` functions are `undefined`. Reproduced at runtime:
  `module keys: onPunchIn, onPunchOut, sendReminders` plus Node warnings
  `Accessing non-existent property 'notifyPunchInSuccess' of module exports inside circular dependency`.
  The failure is swallowed by the local try/catch, so every punch logs
  `notifyPunchInSuccess is not a function` and no confirmation notification is ever sent.
  (`sendReminders` also calls `fn(id)` with one argument where the handlers take `(userId, payload)`.)
- **Fix:** Move the implementations out (or import them from `attendanceScheduler`, which already
  contains them but itself requires the deleted `../services/notificationService`).

### 2.13 Authorization guards built on fields that do not exist
Verified against the live `User` schema: `managerId`, `badges`, `position`, `leftAt`, `joiningDate`,
`name`, `loginAttempts`, `accountStatus`, `securityLogs`, `deviceHistory`, `lastVerificationCheck`
are **all absent**.
- `taskController.js:13-15` — `'hr'` is not a role, and `assignee.managerId` is not a field (it is
  `reportingManager`), so HR admins can never manage tasks and managers never match; `getTasks`
  (`:31-32`) filters `User.find({ managerId: req.user._id })`, which always returns `[]`.
- `employeeController.js:139, 184, 437, 532` — `role: 'hr'` queries, so `GET /api/employees/hr`
  always returns zero, availability stats are always empty, and HR-only endpoints always 400.
- `projectController.js:119, 257-263, 284, 325` — the guard is an **inverted allow-list**: only
  `manager` is ever restricted, so `team_lead`/`hr_admin`/`superadmin` (and any employee on the
  expense route) skip it entirely. `addExpense` has no route guard at all, so any role can inject
  arbitrary amounts into any project's budget ledger.
- `awardController.js:34-46` — `recipient.badges.push(...)` writes a non-schema path, so "award
  created and badge assigned" is returned while nothing is persisted.
- `dailyTaskController.js:200-207` — `$match: { user: userId }` compares a string to an ObjectId in
  an **aggregation** (no Mongoose casting), so `getWeeklySummary` always returns zeros.
- `models/ProjectResponsibility.js:59, 69` — `ref: 'Employee'` but the registered model is `User`;
  `roleController.js:148` populates `createdBy`, so that handler throws `MissingSchemaError`.

### 2.14 Mongoose 7+ removals still called — several features are simply broken
- `awardController.js:155` `await award.remove();` — verified on mongoose 8.19.1:
  `Award.prototype.remove === undefined`. Every `DELETE /api/awards/:id` 500s.
- `aboutController.js:129, 199` `item.remove();` / `stat.remove();` — same, on document-array
  subdocuments, so the About timeline/stats can never be edited.
- **Fix:** `deleteOne()` / `about.timeline.pull({ _id })`.

### 2.15 Socket layer: membership checks and session state are missing
- `socket/chat.js:738-776` — `mark-conversation-read` and `mark-as-read` never verify the caller
  participates in the conversation/message, so read receipts can be forged for arbitrary
  conversations and the real sender is notified (`:764`).
- `socket/webrtc.js:139, 230-316, 553-583, 957-969` — room ids are client-chosen with no ACL, so
  `join-room` can join an ongoing call; `create-room` accepts `user:<victimId>`, the same identifiers
  used for personal rooms (`:90`), letting an attacker sit in a victim's personal room and intercept
  `call-incoming`/`webrtc-offer`/`webrtc-answer`/`webrtc-ice-candidate`. `reject-call` has no
  participant check at all.
- `socket/chat.js:72-84` — the handshake verifies the JWT but never checks `isActive` or
  `currentSessionId`, so a deactivated employee or a device kicked by the single-session policy keeps
  full realtime access (chat, presence, calls) until the token expires; HTTP rejects them immediately.
- `socket/chat.js:217-243, 274-317` — `limit`/`page` from the client are never clamped
  (`limit: 1e9` dumps the message table into one frame).
- `socket/chat.js:143-152, 1080-1083` — `userConnectionHistory` grows forever (only
  `connectionLogs` is cleaned up), storing socket ids, IPs and user-agents per reconnect — a memory
  leak and a PII store that the unauthenticated `/api/debug` route reads back.
- `socket/chat.js:501-503, 614-619` — chat sockets never `socket.join('user:<id>')`, so those
  room-targeted emits reach nobody.

### 2.16 Upload pipeline: auth gaps and under-signed Cloudinary grants
- `uploadController.js:410-423` — `DELETE /api/upload/:publicId` destroys any Cloudinary asset with
  no ownership lookup, and public ids are handed out in normal payloads, so any user can delete
  other users' attachments, avatars, badges or holiday images.
- `uploadController.js:426-438` — only `timestamp` and `folder` are signed, so a client can add
  `public_id` (arbitrary path/overwrite), `format` and `transformation`, with no `allowed_formats`
  or `max_file_size`, while the API key is returned to them.
- `middleware/upload.js:150, 513` — `application/octet-stream` is appended to the allowed MIME list,
  which defeats the extension allow-list, and `image/svg+xml` is permitted (`:76-79`), giving a
  stored-XSS vector if user content is ever served same-origin.
- **Fix:** ownership checks keyed on a DB lookup, a fully-signed upload preset with format/size
  limits, magic-byte sniffing, no SVG, and authenticated delivery.

### 2.17 HR can escalate downward and disable upward
- **Where:** `authController.js:746` (`resetDevice`), `:828` (`setVerification`), `:860` (`assignManager`)
- **Code:** `if (!ADMIN_ROLES.includes(req.user.role)) { throw new AppError('Not authorized', 403, …) }`
- **Why:** Only the **caller's** tier is checked, never the target's. An HR admin can call
  `PATCH /api/auth/verify/:userId {isVerified:false}` on the super-admin, and login hard-blocks
  unverified accounts (`:379-386`) — so a lower tier can lock out a higher one.
- **Fix:** compare `ROLE_RANK[target.role]` against the caller and forbid peers/superiors.

### 2.18 Email and third-party proxies accept attacker-controlled content
- **Where:** `src/routes/emailRoutes.js:158-175` → `src/services/emailService.js:90-106`
- **Code:** `const { to, subject, html, text, attachments } = req.body;` … `sendMail({ …, attachments })`
- **Why:** Nodemailer honours `{ path: '/abs/path' }` (arbitrary **local file read** — `.env`,
  service-account JSON, source) and `{ href: 'http://…' }` (**SSRF**) as attachment sources, so an HR
  session can exfiltrate any file the Node process can read. Arbitrary `html` is also accepted for
  branded phishing, and `/email/bulk` has no recipient cap.
- **Also:** `numberPlateRoutes.js` proxies a third party over **plain HTTP** with no auth and an
  unvalidated plate number, and `geocode.js` proxies Ola Maps with the server key and echoes the raw
  upstream body/status — both are free to abuse at the owner's cost.
- **Fix:** never accept `attachments` from the request body; allow-list `html`/templates, cap
  recipients, and add auth + validation + rate limits to the proxies.

### 2.19 Route shadowing and error-handler gaps
- `src/routes/holidayRoutes.js:40` declares `router.get('/:id', …)` **before** `/export` and `/stats`
  (`:81-82`), so those two super-admin features are unreachable —
  `validateObjectId` rejects `"export"` with `400 Invalid holiday ID`.
- `src/middleware/errorHandler.js:68` never checks `res.headersSent`, so an error raised after a
  response has begun produces `ERR_HTTP_HEADERS_SENT` and an unhandled rejection → the shutdown path
  in `server.js:88-96` exits the process.
- `src/config/cors.js:16` rejects with a plain `Error`, which the handler reports as a **500** with a
  stack trace for what is an ordinary client-side rejection.
- **Fix:** order static segments before `/:id`, add `if (res.headersSent) return next(err);`, and
  reject CORS with an `AppError(…, 403)`.

### 2.20 Admin-role saves silently wipe salary components
- **Where:** `src/models/User.js:452`
- **Code:** `this.salary = { basic: 0, hra: 0, transport: 0, allowances: 0, deductions: 0, netSalary: 0 };`
- **Why:** The schema (`:193-208`) defines `medicalConveyance`, `conveyanceAllowance`,
  `specialAllowance`, `grossSalary`, `employerEPF`, `costToCompany`, `employeeEPF`, `gratuity`,
  `benevolentFund`, `netSalary`; `transport`/`allowances`/`deductions` do not exist. Strict mode drops
  the unknown keys, so any save of an admin-role user zeros `basic`/`hra`/`netSalary` and **deletes**
  every other component. Payroll reads `User.salary.*`.
- **Fix:** do not reset the subdocument; zero only the intended fields.

---

## 3. MEDIUM

1. **Attendance resolution gaps** — `cronJobs.js:103,116` read non-existent `eveningCheckIn/Out`, so
   evening reminders fire for everyone every day; `attendanceController.js:728-746`
   (`markMissedCheckouts`) mixes server-local `setHours(23,59,59,999)` with an IST-midnight date and
   is never scheduled.
2. **Time/shift correctness** — `attendanceController.js:1589-1591` computes `isLate` against
   *today's* 10:00 IST (`getISTStandardTime()`), so HR corrections of historical records write a
   garbage `lateBy`; `shiftUtils.js:70-100` has no "too early" guard and can file a pre-shift punch
   against the coming night shift.
3. **Credit-clock drift** — `cronJobs.js:130-181` sets `leaveCreditedAt = now` rather than the due
   date, so the monthly accrual slides later every cycle; employees deactivated mid-month are never
   back-credited.
4. **Pagination after JS filtering** — `expenseController.js:309-312, 500-505, 569-574` apply the
   department filter after `.skip()/.limit()`, so page 1 can look empty while matches exist later.
5. **Aggregation timezone** — `expenseController.js:600-633, 666-695` group by `$month/$year` with no
   `timezone: 'Asia/Kolkata'`, so anything created 00:00-05:30 IST lands in the previous bucket.
6. **Attendance percentages are conflated** — `attendanceController.js:3015-3019` mixes leave-driven
   half-days, holiday/weekend punches and `on-leave` into one denominator, double-counting half-days.
7. **`updateProfile` allow-list drift** — the `forbiddenFields` list (`authController.js:524-544`)
   omits `salary` and `bankDetails`, so those remain client-writable through the self-service route
   (the `User` pre-save hook only clears them for admin roles, `models/User.js:444-466`).
8. **Unescaped user input in regexes** — `authController.js:1107` and `chatController.js:591`
   build `new RegExp(userInput, 'i')` with no escaping (ReDoS / regex-injection).
   `employeeController.js:26-31` passes `search` straight into `$regex`, and `sortBy` from the query
   is applied to `.sort()` unvalidated (`:38-45`).
9. **`forgotPassword` mails no rate limit / no CSRF-ish protection** — repeated calls mail-bomb any
   known user (`authController.js:676`); reset tokens use `Math.random()` (`models/User.js:576-585`)
   and are stored **unhashed**.
10. **Payroll update path** — `payrollController.js:486-492` (also listed in 1.9) has no status gate
    beyond `hrAdminAndAbove`; `models/Payroll.js:184-189`'s `post('findOneAndUpdate')` re-saves the
    document, double-writing and racing (latent — the controller currently uses `findById` + `save`).
11. **Unbounded socket payloads** — `src/socket/index.js:48` sets `maxHttpBufferSize: 1e8` (100 MB)
    for chat/call traffic; `chat.js:25-39` stores full handshake headers (including the
    `Authorization` token) in memory per connection.
12. **CORS/Helmet posture** — `src/config/cors.js:2-9` hardcodes localhost origins (harmless, but
    the list should be env-driven); `src/socket/index.js:24` allows **any** origin when
    `NODE_ENV !== 'production'`, and a missing `NODE_ENV` silently counts as non-production.
13. **`Error`-handler leaks in development** — `errorHandler.js:98-117` echoes `error.message` for any
    operational error and attaches `error.stack` when `NODE_ENV=development`. Fine locally; it means
    a staging box with `NODE_ENV=development` exposes internals.
14. **Two competing proration definitions** — `attendanceResolver.js:414` computes
    `payableDays/employedDays` while `payrollController.js:211` computes `payableDays/calendarDays`;
    the persisted `attendance.prorationRatio` (`:329`) does not match the one actually used to pay.
15. **`workingDays.js` is locale-dependent dead code** — `:33-38` derives the weekday via
    `toLocaleDateString` while the rest of the codebase uses `moment.tz(...).day()`; the module has
    no importers, so it is a future-bug trap rather than a live defect.
16. **`limit` is uncapped in most list endpoints** (`employeeService.js:6-17`,
    `chatController.js:581-603`, `socket/chat.js:217-317`) — `limit=100000` is accepted.
17. **Client-controlled `sort` reaches Mongoose unvalidated** — `employeeController.js:38-45`
    interpolates an arbitrary `sortBy` key into the sort document, while `projectController.js:179,202`
    and `roleController.js:136,149` accept a raw sort string (usable to force unindexed in-memory
    sorts). Allow-list the keys.
18. **Missing indexes on the hottest collections** — `Announcement` has none (the list endpoint runs
    on every app open with a 3-branch `$or`), likewise `Asset` and `Feedback`; `Call` needs separate
    `callerId`/`calleeId` indexes for the `$or` in `/calls/ongoing/:userId`; `User.resetPasswordToken`
    is queried but unindexed.
19. **`Message.readBy.user` vs the schema's `readBy[].userId`** (`chatController.js:460-474`,
    `models/Message.js:66-69`) — the unread count always evaluates to 0 for the wrong field name;
    `Conversation.unreadCount` is a shared counter with **no writer anywhere**, so
    `/api/chat/unread-count` always returns 0.
20. **`isGlobal` notifications can be deleted for everyone** — `notificationService.js:280-284`
    returns `true` for any `isGlobal`/role-targeted notification, and `deleted`/`deletedBy` live on the
    single shared document, so one employee's `DELETE /api/notifications/:id` hides a company-wide
    broadcast for all users. Role-filtered reads (`:254-260`, `:289-295`) also leak every manager's
    and employee's notifications to any manager.
21. **Poll results de-anonymize voters** — `pollController.js:188-193` spreads the `.lean()` poll, so
    `votedUsers` (User ObjectIds) ships even when `isAnonymous: true`, on an unguarded
    `GET /api/polls/:id`.
22. **Cron jobs have no distributed lock and stamp "last run" before doing work** —
    `cronJobs.js:130-181, 368-390` with `cronLogger.js:5-11`; `startCronJobs()` runs unconditionally in
    `startup.js:15`, so every replica runs the same jobs in the same minute (three share `0 9 * * *`),
    and `getLastCronRun` is imported but unused. `scheduleCelebrationNotifications()` re-registers
    node-cron tasks on every call (`celebrationScheduler.js:247-271`).
23. **Standard-mutation hazards in date code** — `comboOffController.js:24-27` calls
    `mDate.endOf('day')` on a captured moment (mutation is currently harmless but fragile);
    `celebrationController.js:147,193,564` uses bare `moment()` while every other celebration path
    pins `Asia/Kolkata`, so API and cron disagree for ~5.5 h daily.
24. **Constant/validator drift** — `leaveValidator.js:6` allows five leave types the model rejects and
    **blocks** the valid `combo`; `constants/dashboard.js:5` defines `SUPER_ADMIN: 'super_admin'` (the
    real value is `'superadmin'`); `helpers.js:64-71` generates `EMP250001`-style ids that fail the
    `^[A-Z]{7}\d{3}$` regex both validators enforce.
25. **`FAQ` search has no text index** — `faqController.js:234` sets `filter.$text` but `models/Faq.js`
    only indexes `category`, so the public `GET /api/faqs/search?q=` throws
    `text index required for $text query`.
26. **`shifts.js:466-474`** — the `$or` includes `{applicableDesignations: {$size: 0}}`, which matches
    the common unrestricted case, so department/designation targeting is dead and every employee sees
    every shift; `$size: 0` also fails to match a missing field.
27. **Unbounded `Socket.IO` frames and no rate limiting** — `socket/index.js:48` sets
    `maxHttpBufferSize: 1e8` (100 MB) and `apiLimiter` is never mounted, so one authenticated user can
    exhaust memory and Cloudinary quota via `send-message` (`chat.js:397-468, 446-452`).
28. **`allowEIO3: true`** (`socket/index.js:49`) keeps the legacy Engine.IO v3 path alive in
    production although the client is v4.
29. **`firebase/firebase.js:41-45`** calls `process.exit(1)` at require time (imported at
    `startup.js:7`, outside any try), contradicting the documented "Firebase (optional)" handling.
30. **Biometric frames written to disk for "debug"** — `googleVisionService.js:137-141, 302-315`
    persists any frame that fails the magic-byte check under `src/debug-images/` with no retention
    policy or access control.
31. **`employeeController.js:243`** compares a string id to an ObjectId virtual, so that guard never
    matches; **`celebrationController.js:605-623`** documents "HR, superadmin, or self" but performs no
    check, exposing colleagues' DOB/marital status/anniversary/spouse details to any employee;
    **`faceController.js:325-333`** interpolates raw `search` into `$regex` (ReDoS).
32. **Route shadowing** — `holidayRoutes.js:40` declares `/:id` before `/export` and `/stats`
    (`:81-82`), so those two super-admin features are unreachable behind
    `400 Invalid holiday ID`.

---

## 4. LOW / INFO (hygiene)

- **Case-sensitive `require`s that will break on Linux:** `app.js:10`, `errorHandler.js:2`,
  `aboutController.js:6`, `assetController.js:4`, `authController.js:15`, `departmentController.js:4`,
  `employeeController.js:5`, and `comboOffController.js:8` require `'../utils/AppError'` while the
  file on disk is `src/utils/appError.js`. Windows/macOS resolve this; **a Linux deploy will not.**
  (Other controllers already use the lowercase form.)
- **Duplicate helpers:** `asyncHandler.js` and `catchAsync.js` are the same function; only
  `asyncHandler` is used.
- **`models/User.js:296`** defaults `isVerified` to `true`, yet `register` explicitly sets `false`
  (`authController.js:206` uses `creatorRole === SUPER_ADMIN`) while `createEmployee` and the seeds
  set `true` — so the verification gate is inconsistent by design rather than enforced.
- **`authController.js:211`** seeds `leaveBalance: { casual, sick, earned, unpaid }`; the schema has
  only `casual` and `combo` (`models/User.js:222-225`), so the extra keys are dropped silently.
- **`middleware/auth.js:39-41`** logs `decoded.sessionId` and `user.currentSessionId` on every
  request; `login` logs the caller's IP, user-agent, device ID and FCM-token prefix
  (`authController.js:299-307`). Verbose PII in logs.
- **`seedBoth.js`** shells out to `node seedHr.js` from the repo root while the files live in
  `src/seed/` and no `dotenv` is loaded — it cannot work. `check-payroll-attendance.js` and
  `seed-sharique-salary.js` are untracked one-off scripts pointing at a live database with hardcoded
  IDs; `seed-sharique-salary.js:14` has a `./src//models/User` double slash.
- **`app.js:63`** uses `app.all('*')`; fine on Express 4, but it is a breaking pattern on Express 5
  (`'*'` must become `/*splat` or a RegExp) — relevant when you take the `express` advisory upgrade.
- **`models/User.js:346`** `toJSON: { virtuals: true }` with no `transform`, and `documents[].fileUrl`
  are served from `app.js:39` (`/uploads` static) with no auth.
- **Dead/unused surface:** `cronTestController`, `systemRoutes`, `debugRoutes`,
  `notifications.test.js`, `numberPlateRoutes`, `geocode` (see 1.4); `apiLimiter` (2.2);
  `workingDays.js`, `attendanceScheduler.js` (2.10); `escapeHtml` in `utils/sanitize.js` is exported
  but never used.

---

## 5. What is solid

- `protect` verifies the JWT signature, reloads the user, blocks inactive accounts, and enforces
  single-session via `currentSessionId` (modulo the legacy-token hole in 1.8).
- `authorize(...)` / `hrAdminAndAbove` / `managerAndAbove` normalise legacy role aliases and are
  consistently applied to the sensitive attendance/leave/payroll/face routes.
  `sameDepartmentOrAdmin` is written safely.
- `ROLE_CREATION_MATRIX` is properly enforced in `register` (`authController.js:66-77`).
- `updateProfile` uses a `forbiddenFields` allow-list — the right pattern (just incomplete).
- Password hashing is bcrypt with cost 12, with a guard against double-hashing
  (`models/User.js:426-441`); `password` is `select: false` and `matchPassword` uses `bcrypt.compare`.
- `Attendance` has a `{ employee, date }` unique index and `Payroll` a unique `{employee, month, year}`
  index; `Payroll.recalc` is idempotent and `status` gates post-payment edits.
- `leaveController`'s ownership/approval checks (`canActOnLeave`, `getLeave`, cancel rules) and the
  self-scoped `/my-*` endpoints are correct.
- `attendanceResolver`'s holiday/weekend/leave/attendance precedence is coherent, IST-aware, and
  correctly uses `workDate` / `startDate` / `endDate`; `istKey`/`istMidnight` avoid server-local time.
- `geoFence.js` haversine + segment-projection maths is correct (clamped `t`, no division by zero),
  and its ACL filter loads the allow-lists properly (`:81`). `faceMatch.js` normalises embeddings and
  guards magnitude 0 — note the flaw is upstream (see 1.12), not in this helper.
- `payrollController` validates month/year ranges, blocks future months, rejects duplicate periods
  and out-of-window employment, and applies the EPF wage ceiling before proration.
- No `eval`/`Function`, no `$where`, no string-built Mongo operators. `.select('-password')` is used
  on the employee list/detail reads.
- JWT verification itself is correct everywhere it happens — `src/middleware/auth.js:38-45` plus all
  three socket namespaces (`chat.js:72`, `webrtc.js:43`, `notification.js:35`) use `jwt.verify` with
  a real DB lookup; there is no `decode()`-only path and `socket.user` is always rebuilt from the DB
  row, never from client-supplied ids.
- Socket *message* binding is correct: `chat.js:400` takes the sender from `socket.user`, group sends
  verify membership (`:824-830`), `load-messages` verifies participation (`:225-235`), and
  `load-history` is scoped to the requester (`:288-293`). `accept-call` (`webrtc.js:888-895`),
  `end-call` (`:1152-1160`) and `toggle-room-lock` (`:515-521`) do check their targets.
- `tokenController.deleteTokenById` (`:63-77`) performs a real ownership/role check, so that route is
  safe despite lacking a role guard.
- Duplicate-key (11000), CastError, ValidationError and JWT errors are all normalised to
  400/409/422/401 by `errorHandler.js`, and generic 500s return `'Internal server error'`.
- `config/cors.js` uses an explicit origin allow-list and never pairs `credentials: true` with a
  wildcard. `config/db.js` fails fast without logging credentials, and Cloudinary credentials come
  only from env.
- No `child_process.exec` anywhere — `simple-git` is invoked with argument arrays, so the commit
  `message` is not shell-injectable.
- `server.js:51-97` shutdown handling is sound: single-shot guard, 10 s force-exit timer,
  `closeAllConnections()` for keep-alive sockets.
- `.env` is gitignored and was never committed (`git log --all -- .env` is empty); the Firebase
  **admin** service-account JSON is untracked (`src/config/google-credentials.json`), and
  `Google Vision` also supports passing credentials via env.
- Handlebars templates are compiled from fixed filenames with default escaping and no
  user-controlled template source (`emailService.js:196-217`), so the handlebars advisory is not
  reachable today; `sendBulkEmail` batches at 10 with a delay and a per-recipient retry cap.
- Cron task bodies are individually try/catch-wrapped and return `{success:false,error}` rather than
  throwing (`cronJobs.js:131-181, 198-302`), and all eight schedules pin `timezone: 'Asia/Kolkata'`.
- `leavePermissions` (`canActOnLeave`/`canViewLeave`) defaults to false, passes HR/superadmin, and
  restricts managers to direct reports; `groupAuth`'s participant checks use the DB user id, require
  `p.isActive`, and default to non-public (`Conversation.settings.isPublic` is `false`).

---

## 6. How this was verified

- Read-only review of `src/**` in four parallel passes (auth/authz, attendance-leave-payroll,
  infra/routes/sockets/uploads, remaining controllers/models) plus the root scripts.
- **Module-resolution scan of every relative `require` in `src/**`** — this is what found 1.1, 2.10.
- **Live model schemas** inspected for the field/`enum` claims in 1.5, 1.6, 1.15 and 2.13
  (`ComboOff.workDate`, `Leave.startDate/endDate`, `Attendance.status` enum, `RestrictedHolidayUsage`,
  `Token.tokenType` enum, and the absence of `loginAttempts`/`accountStatus`/`securityLogs`/
  `badges`/`managerId`).
- **Runtime checks in Node** (no DB connection, no writes): the self-require in
  `attendanceNotifications.js` reproduces the circular-dependency warnings and leaves
  `onPunchIn`/`onPunchOut` calling `undefined`; `cronTasks` keys were enumerated to confirm
  `autoCheckoutEmployees`/`markAbsentEmployees` do not exist; `award.remove` was confirmed absent on
  mongoose 8.19.1.
- **`moment-timezone` behaviour tested in Node** — `moment.tz({year, month, date:1}, 'Asia/Kolkata')`
  and `new Date(year, month, 0).getDate()` both behave as intended (one reviewer suspect was
  disproved this way and is **not** reported above; whole classes of "argument dropped" claims from a
  first-pass reviewer were dropped after this test).
- `npm audit --omit=dev` for the dependency section; `npm ls axios` and `package.json` inspection for
  the undeclared dependency.
- `git ls-files` / `git log --all` for the tracked-upload, `.gitignore` and committed-secret checks.
- Line numbers are from the current working tree, which has **23 modified/untracked files**
  (`git status`); re-anchor before patching.
- No application code was run against the live database (no server start, no migrations), and no
  files were modified by this audit — this report is the only new file.
