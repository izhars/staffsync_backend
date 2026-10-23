const EMAIL_TOKENS = {
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",

  // Mirrors COLORS.blue / green / amber / red / purple / slate
  colors: {
    blue:   { bg: "#E6F1FB", text: "#185FA5", border: "#85B7EB" },
    green:  { bg: "#E1F5EE", text: "#0F6E56", border: "#A8E3D0" },
    amber:  { bg: "#FAEEDA", text: "#854F0B", border: "#FAC775" },
    red:    { bg: "#FCEBEB", text: "#A32D2D", border: "#F7C1C1" },
    purple: { bg: "#EEEDFE", text: "#3C3489", border: "#C7C4F5" },
    slate:  { bg: "#f3f4f6", text: "#6b7280", border: "#e5e7eb" },
  },

  // Surfaces + brand (mirrors PAGE_BG / CARD_BG / PRIMARY / PRIMARY_HOVER)
  pageBg: "#f9fafb",
  cardBg: "#fff",
  primary: "#185FA5",
  primaryHover: "#0C447C",
  textPrimary: "#1a1d29",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  border: "#e5e7eb",
  borderLight: "#f3f4f6",
};

/* ---------- tiny HTML helpers (email-safe) ---------- */

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const pill = (label, tone = "blue") => {
  const c = EMAIL_TOKENS.colors[tone] || EMAIL_TOKENS.colors.slate;
  return `<span style="display:inline-block; padding:3px 9px; border-radius:6px; font-size:10px; font-weight:500; background:${c.bg}; color:${c.text}; border:1px solid ${c.border}; white-space:nowrap;">${escapeHtml(label)}</span>`;
};

const divider = () =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-bottom:1px solid ${EMAIL_TOKENS.borderLight}; font-size:0; line-height:0;">&nbsp;</td></tr></table>`;

const button = (href, label) => {
  const t = EMAIL_TOKENS;
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
    <tr>
      <td align="center" bgcolor="${t.primary}" style="border-radius:8px; background-color:${t.primary}; border:1px solid ${t.primaryHover};">
        <a href="${escapeHtml(href)}" target="_blank"
           style="display:inline-block; padding:12px 28px; font-family:${t.font}; font-size:14px; font-weight:600; color:#FFFFFF !important; text-decoration:none; border-radius:8px; letter-spacing:0.01em;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
};

/* ============================================================
   Main export — unchanged signature
   ============================================================ */

exports.generateForgotPasswordEmail = (
  resetUrl,
  { appName = "HRMS", expiryMinutes = 10, isDark = false } = {}
) => {
  const t = EMAIL_TOKENS;
  // Emails are forced light for consistent rendering; isDark kept for API symmetry.
  void isDark;

  const safeUrl = escapeHtml(resetUrl);
  const safeApp = escapeHtml(appName);
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Reset your ${safeApp} password</title>
</head>
<body style="margin:0; padding:0; background-color:${t.pageBg}; font-family:${t.font}; color:${t.textPrimary}; -webkit-text-size-adjust:100%;">

  <!-- Preheader -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    Use this link to reset your ${safeApp} password. It expires in ${expiryMinutes} minutes.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${t.pageBg};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Brand -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
          <tr>
            <td style="font-family:${t.font}; font-size:16px; font-weight:700; letter-spacing:0.02em; color:${t.textPrimary};">
              <span style="display:inline-block; width:8px; height:8px; background-color:${t.primary}; border-radius:50%; margin-right:8px; vertical-align:middle;"></span>${safeApp}
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="max-width:520px; background-color:${t.cardBg}; border:1px solid ${t.borderLight}; border-radius:12px; overflow:hidden;">

          <!-- Accent bar (brand primary) -->
          <tr>
            <td height="4" bgcolor="${t.primary}" style="height:4px; font-size:0; line-height:0; background-color:${t.primary};">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:36px 32px 12px 32px;" align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td align="center" width="56" height="56" bgcolor="${t.colors.blue.bg}"
                      style="width:56px; height:56px; border-radius:12px; background-color:${t.colors.blue.bg}; border:1px solid ${t.colors.blue.border}; font-size:24px; line-height:56px;">
                    🔒
                  </td>
                </tr>
              </table>

              <h1 style="margin:20px 0 8px 0; font-family:${t.font}; font-size:22px; line-height:1.3; font-weight:700; color:${t.textPrimary}; letter-spacing:-0.01em;">
                Reset your password
              </h1>
              <p style="margin:0; font-family:${t.font}; font-size:14px; line-height:1.6; color:${t.textSecondary};">
                We received a request to reset the password for your ${safeApp} account.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:22px 32px 6px 32px;" align="center">
              ${button(resetUrl, "Reset Password")}

              <p style="margin:16px 0 0 0; font-family:${t.font}; font-size:12px; color:${t.textMuted};">
                ⏱ This link expires in <strong style="color:${t.textPrimary};">${expiryMinutes} minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- Fallback URL -->
          <tr>
            <td style="padding:22px 32px 6px 32px;">
              <p style="margin:0 0 8px 0; font-family:${t.font}; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; color:${t.textMuted};">
                Button not working? Paste this link
              </p>
              <div style="background-color:${t.pageBg}; border:1px solid ${t.borderLight}; border-radius:8px; padding:10px 12px; font-family:${t.mono}; font-size:11.5px; line-height:1.5; word-break:break-all; color:${t.primary};">
                <a href="${safeUrl}" target="_blank" style="color:${t.primary}; text-decoration:none; font-family:${t.mono};">${safeUrl}</a>
              </div>
            </td>
          </tr>

          ${divider()}

          <!-- Security note -->
          <tr>
            <td style="padding:18px 32px 32px 32px;">
              <div style="background-color:${t.colors.amber.bg}; border:1px solid ${t.colors.amber.border}; border-radius:8px; padding:12px 14px; font-family:${t.font}; font-size:12.5px; line-height:1.5; color:${t.colors.amber.text};">
                <strong>Didn’t request this?</strong> You can safely ignore this email — your password will remain unchanged.
              </div>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
          <tr>
            <td align="center" style="padding:20px 20px 0 20px; font-family:${t.font}; font-size:11.5px; line-height:1.6; color:${t.textMuted};">
              ${pill("Automated message", "slate")}
              <div style="margin-top:8px;">
                &copy; ${year} ${safeApp}. All rights reserved.<br />
                This is an automated message — please do not reply.
              </div>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};