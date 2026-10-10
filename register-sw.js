// Nur über HTTPS aktivieren (GitHub Pages stellt HTTPS bereit).
if(location.protocol==='https:'&&'serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(error=>console.warn('Offline-App konnte nicht aktiviert werden:',error));});}
