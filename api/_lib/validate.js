/**
 * PAP Magazine - Input Validation Helpers
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sanitize a string (trim + remove HTML tags)
 */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/<[^>]*>/g, '');
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

/**
 * Validate required fields exist in body
 * Returns { valid: true } or { valid: false, message: '...' }
 */
function requireFields(body, fields) {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body is required' };
  }
  for (const field of fields) {
    const val = body[field];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      return { valid: false, message: `"${field}" is required` };
    }
  }
  return { valid: true };
}

/**
 * Validate string length
 */
function isValidLength(str, min = 1, max = 10000) {
  if (typeof str !== 'string') return false;
  const len = str.trim().length;
  return len >= min && len <= max;
}

/**
 * Validate UUID format
 */
function isValidUUID(str) {
  return typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Validate pagination params
 * Returns sanitized { page, perPage }
 */
function parsePagination(query, defaultPerPage = 20, maxPerPage = 100) {
  let page = parseInt(query.page) || 1;
  let perPage = parseInt(query.perPage || query.limit) || defaultPerPage;
  if (page < 1) page = 1;
  if (perPage < 1) perPage = 1;
  if (perPage > maxPerPage) perPage = maxPerPage;
  return { page, perPage };
}

module.exports = {
  sanitize,
  isValidEmail,
  requireFields,
  isValidLength,
  isValidUUID,
  parsePagination,
};
