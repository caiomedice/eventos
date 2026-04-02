// EventosPt — patch.js
// Corrige: distância padrão, navegação por endereço, eventos futuros, auth
// Adiciona esta linha antes do </body> no index.html:
// <script src="patch.js"></script>

(function() {
  'use strict';

  // ─── 1. Aumentar raio padrão para 50km ao iniciar ─────────────────────────
  // Corre assim que o DOM estiver pronto
  function fixDistancia() {
    var el = document.getElementById('dist-val');
    var slider = document.querySelector('input[type="range"][oninput*="updateDist"]');
    if (el && el.textContent === '5') {
      el.textContent = '50';
      if (slider) slider.value = '50';
    }
  }

  // ─── 2. Sobrescrever getCoords para usar endereço do evento ───────────────
  window._getEventAddress = function(id) {
    // Tenta primeiro EVENT_COORDS (preenchido da BD)
    if (typeof EVENT_COORDS !== 'undefined' && EVENT_COORDS[id]) {
      return EVENT_COORDS[id];
    }
    // Fallback: procura o evento e constrói o endereço
    if (typeof EVENTS !== 'undefined') {
      var ev = EVENTS.find(function(e) { return e.id === id; });
      if (ev) {
        var addr = ev.venue || ev.name || 'Porto, Portugal';
        // Garante que termina com Portugal para melhor geocodificação
        if (!addr.toLowerCase().includes('portugal')) addr += ', Portugal';
        return { lat: null, lng: null, address: addr };
      }
    }
    return { lat: null, lng: null, address: 'Porto, Portugal' };
  };

  window.getCoords = function(id) {
    return window._getEventAddress(id);
  };

  // ─── 3. Sobrescrever funções de navegação ────────────────────────────────
  window.openWaze = function(e) {
    if (e) e.preventDefault();
    var c = window._getEventAddress(typeof currentEventId !== 'undefined' ? currentEventId : 0);
    var q = encodeURIComponent(c.address);
    var url = (c.lat && c.lng)
      ? 'https://waze.com/ul?ll=' + c.lat + ',' + c.lng + '&navigate=yes&zoom=17'
      : 'https://waze.com/ul?q=' + q + '&navigate=yes';
    if (typeof showToast === 'function') showToast('🚗 A abrir o Waze...');
    setTimeout(function() { window.open(url, '_blank'); }, 300);
  };

  window.openGoogleMaps = function(e) {
    if (e) e.preventDefault();
    var c = window._getEventAddress(typeof currentEventId !== 'undefined' ? currentEventId : 0);
    var dest = (c.lat && c.lng) ? c.lat + ',' + c.lng : encodeURIComponent(c.address);
    var url = 'https://www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=driving';
    if (typeof showToast === 'function') showToast('🗺 A abrir o Google Maps...');
    setTimeout(function() { window.open(url, '_blank'); }, 300);
  };

  window.openAppleMaps = function(e) {
    if (e) e.preventDefault();
    var c = window._getEventAddress(typeof currentEventId !== 'undefined' ? currentEventId : 0);
    var q = encodeURIComponent(c.address);
    var url = (c.lat && c.lng)
      ? 'https://maps.apple.com/?daddr=' + c.lat + ',' + c.lng + '&dirflg=d'
      : 'https://maps.apple.com/?q=' + q + '&dirflg=d';
    if (typeof showToast === 'function') showToast('🍎 A abrir o Apple Maps...');
    setTimeout(function() { window.open(url, '_blank'); }, 300);
  };

  window.copyAddress = function() {
    var c = window._getEventAddress(typeof currentEventId !== 'undefined' ? currentEventId : 0);
    var text = c.address;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        if (typeof showToast === 'function') showToast('📋 Endereço copiado!');
      }).catch(function() {
        _copyFallback(text);
      });
    } else {
      _copyFallback(text);
    }
  };

  function _copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); if (typeof showToast === 'function') showToast('📋 Endereço copiado!'); }
    catch(x) { if (typeof showToast === 'function') showToast('📋 ' + text); }
    document.body.removeChild(ta);
  }

  // ─── 4. Sobrescrever updateMapForEvent para usar endereço ─────────────────
  window.updateMapForEvent = function(id) {
    var c = window._getEventAddress(id);

    // Atualiza o texto de copiar imediatamente
    var copyEl = document.getElementById('copy-address-text');
    if (copyEl) copyEl.textContent = c.address;

    var iframe = document.getElementById('detail-map-iframe');
    var overlay = document.getElementById('map-overlay');

    if (iframe) {
      var src;
      if (c.lat && c.lng) {
        var d = 0.025;
        src = 'https://www.openstreetmap.org/export/embed.html'
          + '?bbox=' + (c.lng-d) + ',' + (c.lat-d) + ',' + (c.lng+d) + ',' + (c.lat+d)
          + '&layer=mapnik&marker=' + c.lat + ',' + c.lng;
      } else {
        // Sem GPS — pesquisa por texto
        src = 'https://www.openstreetmap.org/export/embed.html'
          + '?query=' + encodeURIComponent(c.address)
          + '&layer=mapnik';
      }
      iframe.src = src;
      iframe.style.pointerEvents = 'none';
    }
    if (overlay) overlay.classList.remove('hidden');
  };

  // ─── 5. Corrigir loadDBEvents para 30 dias e mapear todos os campos ───────
  // Espera que o Supabase esteja inicializado e substitui a função
  function patchLoadDBEvents() {
    if (!window._supabase) {
      setTimeout(patchLoadDBEvents, 200);
      return;
    }
    var client = window._supabase;

    window.loadDBEvents = async function() {
      try {
        var desde = new Date(Date.now() - 30*60*1000).toISOString();
        var ate   = new Date(Date.now() + 30*24*60*60*1000).toISOString();
        var r = await client.from('events').select('*')
          .eq('status', 'approved')
          .gt('data_hora', desde)
          .lt('data_hora', ate)
          .order('data_hora', { ascending: true })
          .limit(200);

        if (r.error || !r.data || !r.data.length) return;

        r.data.forEach(function(ev) {
          // Regista endereço para navegação
          var addr = ev.local + (ev.endereco ? ', ' + ev.endereco : '') + ', Portugal';
          if (typeof EVENT_COORDS !== 'undefined') {
            EVENT_COORDS[ev.id] = { lat: ev.lat || null, lng: ev.lng || null, address: addr };
          }

          var converted = {
            id: ev.id,
            name: ev.nome,
            genre: ev.genero,
            category: ev.categoria || 'music',
            emoji: ev.emoji || '🎉',
            dateObj: new Date(ev.data_hora),
            date: typeof formatEventDate === 'function'
              ? formatEventDate(new Date(ev.data_hora))
              : ev.data_hora,
            venue: ev.local + (ev.endereco ? ' · ' + ev.endereco : ''),
            dist: 1, // neutro — não filtrado por distância aleatória
            going: String(ev.going_count || Math.floor(Math.random() * 400 + 50)),
            price: ev.preco || 'Grátis',
            source: ev.fonte || 'EventosPt',
            url: ev.url_ingresso || null,
            c1: ev.cor1 || '#0e1118',
            c2: ev.cor2 || '#312e81',
            recommended: ev.recomendado || false,
            tags: [ev.genero],
            fromDB: true,
            descricao: ev.descricao || null,
            fotos: ev.url_foto ? [ev.url_foto] : [],
            video: ev.video_url || null,
          };

          if (typeof EVENTS !== 'undefined' && !EVENTS.find(function(e) { return e.id === converted.id; })) {
            EVENTS.push(converted);
          }
        });

        if (typeof applyFilters === 'function') applyFilters();
        console.log('[patch] ✅ ' + r.data.length + ' eventos carregados (30 dias)');
      } catch(err) {
        console.warn('[patch] loadDBEvents:', err.message);
      }
    };

    // Recarrega imediatamente se já há sessão
    if (typeof currentUser !== 'undefined' && currentUser) {
      window.loadDBEvents();
    }

    console.log('[patch] ✅ loadDBEvents substituído');
  }

  // ─── 6. Aplicar tudo quando o DOM estiver pronto ─────────────────────────
  function init() {
    fixDistancia();
    patchLoadDBEvents();
    console.log('[patch] ✅ EventosPt patch aplicado');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
