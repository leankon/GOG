/**
 * Función serverless (Vercel): POST /api/resolve
 *
 * Misma lógica que el servidor local; aquí sólo se adapta la petición y la
 * respuesta al formato de Vercel. Todo error se devuelve como JSON, para que
 * el navegador vea el motivo en vez de un 500 opaco.
 */
import { resolve } from '../lib/resolve.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Usa POST.' });
    return;
  }

  try {
    // Vercel ya parsea el JSON cuando llega con Content-Type correcto;
    // si no, lo leemos del cuerpo tal cual.
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const url = body.url;

    if (typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ ok: false, error: 'Falta el campo "url".' });
      return;
    }

    res.status(200).json(await resolve(url));
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al resolver el enlace: ' + error.message });
  }
}
