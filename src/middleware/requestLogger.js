// src/middleware/requestLogger.js

module.exports = function requestLogger(req, res, next) {
  const startTime = Date.now();

  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  // Log when request comes in
  console.log(
    `➡️  [${timestamp}] ${method} ${url} | IP: ${ip}`
  );

  // Wait until response is finished
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    let icon = "✅";

    if (statusCode >= 400 && statusCode < 500) {
      icon = "⚠️";
    } else if (statusCode >= 500) {
      icon = "❌";
    }

    console.log(
      `${icon} [${new Date().toISOString()}] ${method} ${url} | ` +
      `Status: ${statusCode} | ${duration}ms`
    );
  });

  next();
};