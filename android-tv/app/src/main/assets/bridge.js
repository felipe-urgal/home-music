(() => {
  const status = document.getElementById('status');
  const opener = window.opener;

  const setStatus = message => {
    if (status) status.textContent = message;
  };

  if (!opener) {
    setStatus('Sem janela de origem. Abra este teste pelo Home Music.');
    return;
  }

  window.addEventListener('message', event => {
    if (event.source !== opener) return;
    const data = event.data;
    if (!data || data.type !== 'home-music-lan-bridge-ping' || typeof data.nonce !== 'string') return;
    opener.postMessage({ type: 'home-music-lan-bridge-pong', nonce: data.nonce }, event.origin);
    setStatus('PONG enviado ao Home Music.');
  });

  opener.postMessage({ type: 'home-music-lan-bridge-ready' }, '*');
  setStatus('Bridge aberto. Aguardando PING do Home Music…');
})();
