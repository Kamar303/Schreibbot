/* Handschrift PWA service worker – v2 for the updated PNG/PDF release. */
const CACHE_NAME='handschrift-pwa-v2';
const CORE_FILES=['./','./index.html','./manifest.webmanifest','./register-sw.js','./icons/apple-touch-icon.png','./icons/favicon-32.png','./icons/icon-192.png','./icons/icon-512.png','./datenschutz.html','./impressum.html'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE_FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('handschrift-pwa-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==self.location.origin)return;e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{if(res&&res.ok&&res.type==='basic'){const copy=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(r,copy)).catch(()=>{});}return res;}).catch(()=>{if(r.mode==='navigate')return caches.match('./index.html');throw new Error('Offline: Datei nicht im Cache verfügbar.');})));});
