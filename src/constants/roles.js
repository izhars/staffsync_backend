// constants/roles.js

const ACCESS_ROLES = {
  SUPER_ADMIN: 'superadmin',
  HR_ADMIN:    'hr_admin',
  MANAGER:     'manager',
  TEAM_LEAD:   'team_lead',
  EMPLOYEE:    'employee',
};

// Notification role targets (what a notification can be addressed to)
// These must align with ACCESS_ROLES but include 'all' as a broadcast target.
const NOTIFICATION_ROLES = {
  ALL:        'all',
  SUPER_ADMIN: ACCESS_ROLES.SUPER_ADMIN,
  HR_ADMIN:    ACCESS_ROLES.HR_ADMIN,
  MANAGER:     ACCESS_ROLES.MANAGER,
  TEAM_LEAD:   ACCESS_ROLES.TEAM_LEAD,
  EMPLOYEE:    ACCESS_ROLES.EMPLOYEE,
};

// Who can create whom (user management).
const ROLE_CREATION_MATRIX = {
  superadmin: ['hr_admin', 'manager', 'team_lead', 'employee'],
  hr_admin:   ['manager', 'team_lead', 'employee'],
  manager:    ['team_lead', 'employee'],
  team_lead:  [],
  employee:   [],
};

// Who can send notifications to which roles.
const NOTIFICATION_TARGET_MATRIX = {
  superadmin: ['all', 'superadmin', 'hr_admin', 'manager', 'team_lead', 'employee'],
  hr_admin:   ['all', 'hr_admin', 'manager', 'team_lead', 'employee'],
  manager:    ['all', 'manager', 'team_lead', 'employee'],
  team_lead:  ['all', 'team_lead', 'employee'],
  employee:   ['employee'], // employees can only notify themselves
};

// Numeric authority ranking (higher = more authority).
const ROLE_RANK = {
  superadmin: 100,
  hr_admin:   80,
  manager:    60,
  team_lead:  40,
  employee:   20,
};

// Human-readable labels for UI / logs
const ROLE_LABELS = {
  superadmin: 'Super Admin',
  hr_admin:   'HR Admin',
  manager:    'Manager',
  team_lead:  'Team Lead',
  employee:   'Employee',
};

// Roles that carry personal / salary / bank info.
const NON_ADMIN_ROLES = [
  ACCESS_ROLES.HR_ADMIN,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.TEAM_LEAD,
  ACCESS_ROLES.EMPLOYEE,
];

// Roles that should NOT carry personal / salary / bank info.
const ADMIN_ROLES = [ACCESS_ROLES.SUPER_ADMIN, ACCESS_ROLES.HR_ADMIN];

// ── Legacy role normalization ──────────────────────────────────
// Maps old/alias role names to canonical ACCESS_ROLES values.
const LEGACY_ROLE_ALIASES = {
  admin:       ACCESS_ROLES.HR_ADMIN,
  hr:          ACCESS_ROLES.HR_ADMIN,
  hr_admin:    ACCESS_ROLES.HR_ADMIN,
  superadmin:  ACCESS_ROLES.SUPER_ADMIN,
  super_admin: ACCESS_ROLES.SUPER_ADMIN,
  teamlead:    ACCESS_ROLES.TEAM_LEAD,
  team_lead:   ACCESS_ROLES.TEAM_LEAD,
  manager:     ACCESS_ROLES.MANAGER,
  employee:    ACCESS_ROLES.EMPLOYEE,
};

const normalizeRoleName = (role) => {
  const roleName = String(role || '').trim().toLowerCase();
  return LEGACY_ROLE_ALIASES[roleName] || roleName;
};

// ── Convenience predicates ─────────────────────────────────────
const hasRankAtLeast = (role, minRole) => {
  const userRank = ROLE_RANK[normalizeRoleName(role)] ?? -1;
  const minRank  = ROLE_RANK[normalizeRoleName(minRole)] ?? Infinity;
  return userRank >= minRank;
};

const isSuperAdmin  = (role) => normalizeRoleName(role) === ACCESS_ROLES.SUPER_ADMIN;
const isHrAdmin     = (role) => normalizeRoleName(role) === ACCESS_ROLES.HR_ADMIN;
const isManager     = (role) => normalizeRoleName(role) === ACCESS_ROLES.MANAGER;
const isTeamLead    = (role) => normalizeRoleName(role) === ACCESS_ROLES.TEAM_LEAD;
const isEmployee    = (role) => normalizeRoleName(role) === ACCESS_ROLES.EMPLOYEE;

const isHrAdminOrAbove    = (role) => hasRankAtLeast(role, ACCESS_ROLES.HR_ADMIN);
const isManagerOrAbove    = (role) => hasRankAtLeast(role, ACCESS_ROLES.MANAGER);
const isTeamLeadOrAbove   = (role) => hasRankAtLeast(role, ACCESS_ROLES.TEAM_LEAD);

module.exports = {
  ACCESS_ROLES,
  NOTIFICATION_ROLES,
  ROLE_CREATION_MATRIX,
  NOTIFICATION_TARGET_MATRIX,
  ROLE_RANK,
  ROLE_LABELS,
  NON_ADMIN_ROLES,
  ADMIN_ROLES,
  LEGACY_ROLE_ALIASES,
  normalizeRoleName,
  hasRankAtLeast,
  isSuperAdmin,
  isHrAdmin,
  isManager,
  isTeamLead,
  isEmployee,
  isHrAdminOrAbove,
  isManagerOrAbove,
  isTeamLeadOrAbove,
};