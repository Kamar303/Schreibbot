/* Handschrift PWA service worker – v38: full-collection achievement and platinum theme. */
const CACHE_NAME='handschrift-pwa-v38';
// Keep this list limited to files required by the app shell. A missing optional
// file in cache.addAll() would abort the entire service-worker installation.
const CORE_FILES=[
  './',
  './index.html',
  './goodnotes-template.js',
  './manifest.webmanifest',
  './register-sw.js',
  './apple-touch-icon.png',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
  './datenschutz.html',
  './impressum.html'
];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE_NAME)
    .then(cache=>cache.addAll(CORE_FILES))
    .then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('handschrift-pwa-')&&key!==CACHE_NAME).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response&&response.ok&&response.type==='basic'){
      const copy=response.clone();
      caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
    }
    return response;
  }).catch(()=>{
    if(request.mode==='navigate')return caches.match('./index.html');
    throw new Error('Offline: Datei nicht im Cache verfügbar.');
  })));
});
