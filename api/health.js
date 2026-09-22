/** Función serverless (Vercel): GET /api/health — comprueba que la API vive. */
import { VERSION } from '../public/version.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    version: VERSION,
    apiKeyConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    runtime: process.version,
  });
}
