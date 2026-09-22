/**
 * Service worker mínimo. No cachea nada a propósito: sólo existe porque un
 * navegador exige uno para poder instalar la app, y la instalación es lo que
 * mete la app en el menú "Compartir" de Android (share_target del manifiesto).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
