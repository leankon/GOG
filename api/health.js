/** Función serverless (Vercel): GET /api/health — comprueba que la API vive. */
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    apiKeyConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    runtime: process.version,
  });
}
