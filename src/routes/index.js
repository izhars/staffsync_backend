// src/routes/index.js
const { Router } = require('express');

/**
 * Central API route registry.
 * Each entry: { path: '/mount-path', router: require('./file') }
 * Add new routes here — no need to touch app.js.
 */
const routes = [
  { path: '/auth', router: require('./authRoutes') },
  { path: '/employees', router: require('./employeeRoutes') },
  { path: '/attendance', router: require('./attendanceRoutes') },
  { path: '/leaves', router: require('./leaveRoutes') },
  { path: '/payroll', router: require('./payrollRoutes') },
  { path: '/departments', router: require('./departmentRoutes') },
  { path: '/announcements', router: require('./announcementRoutes') },
  { path: '/assets', router: require('./assetRoutes') },
  { path: '/dashboard', router: require('./dashboardRoutes') },
  { path: '/holidays', router: require('./holidayRoutes') },
  { path: '/celebrations', router: require('./celebrationRoutes') },
  { path: '/chat', router: require('./chatRoutes') },
  { path: '/feedbacks', router: require('./feedbackRoutes') },
  { path: '/polls', router: require('./pollRoutes') },
  { path: '/awards', router: require('./awardRoutes') },
  { path: '/badges', router: require('./badgeRoutes') },
  { path: '/notifications', router: require('./notificationRoutes') },
  { path: '/cron', router: require('./cronTestRoutes') },
  { path: '/combooff', router: require('./comboOffRoutes') },
  { path: '/faqs', router: require('./faqRoutes') },
  { path: '/help-topics', router: require('./helpRoutes') },
  { path: '/tickets', router: require('./ticketRoutes') },
  { path: '/about', router: require('./aboutRoutes') },
  { path: '/email', router: require('./emailRoutes') },
  { path: '/upload', router: require('./uploadRoutes') },
  { path: '/tasks', router: require('./taskRoutes') },
  { path: '/system', router: require('./systemRoutes') },
  { path: '/expenses', router: require('./expenseRoutes') },
  { path: '/expense-categories', router: require('./expenseCategoryRoutes') },
  { path: '/projects', router: require('./projectRoutes') },
  { path: '/project-roles', router: require('./roleRoutes') },
  { path: '/tokens', router: require('./tokenRoutes') },
  { path: '/debug', router: require('./debugRoutes') },
  { path: '/daily-tasks', router: require('./dailyTaskRoutes') },
  { path: '/calls', router: require('./callRoutes') },
  { path: '/employee-interactions', router: require('./employeeInteractionRoutes') },
  { path: '/rfid-scans', router: require('./rfidRoutes') },
  { path: '/plate', router: require('./numberPlateRoutes') },
  { path: '/geo-fence', router: require('./geoFence') },
  { path: '/geocode', router: require('./geocode') },
  { path: '/face', router: require('./faceRoutes') },
  { path: '/github', router: require('./githubRoutes') },
  { path: '/shifts', router: require('./shifts') },
  { path: '/test_notifications', router: require('./notifications.test') },
];

function registerRoutes(app) {
  const api = Router();
  for (const { path, router } of routes) {
    api.use(path, router);
  }
  app.use('/api', api);
}

module.exports = { registerRoutes, routes };