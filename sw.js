/* Garde l'application en cache pour qu'elle s'ouvre même sans réseau.
   Changer VERSION à chaque mise à jour des fichiers. Les appels aux IA ne passent jamais par le cache. */
const VERSION = "pncm-v2";
const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "ia.js", "export.js", "manifest.webmanifest",
  "vendor/docx.iife.js", "icones/icone-192.png", "icones/icone-512.png", "icones/apple-touch-icon.png", "icones/icone-maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(c => c !== VERSION).map(c => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Réseau d'abord (pour avoir la dernière version), cache si hors ligne.
  e.respondWith(
    fetch(e.request)
      .then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
