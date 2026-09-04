/**
 * PAP Magazine - CORS Helper
 */

// Production origins only — localhost allowed only in development
const PROD_ORIGINS = [
  'https://www.pap-magazine.com',
  'https://pap-magazine.com',
  'https://www.papkorea.com',
  'https://papkorea.com',
  'https://pap-magazine.vercel.app',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const isDev = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development';
const ALLOWED_ORIGINS = isDev ? PROD_ORIGINS.concat(DEV_ORIGINS) : PROD_ORIGINS;

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleCors(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = { handleCors, setCors, ALLOWED_ORIGINS };
