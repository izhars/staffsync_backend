// utils/sanitize.js
const { MAX_DOCUMENTS } = require('../constants/leave');

const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const sanitizeText = (str, maxLen = 2000) => {
  if (str == null) return '';
  return String(str).trim().slice(0, maxLen);
};

/**
 * Accepts only http(s) URLs or relative /uploads/ paths.
 */
const sanitizeDocumentUrls = (docs, max = MAX_DOCUMENTS) => {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim())
    .filter((d) => /^https?:\/\//i.test(d) || d.startsWith('/uploads/'))
    .slice(0, max);
};

module.exports = { escapeHtml, sanitizeText, sanitizeDocumentUrls };