// supabase-integration.js — EventosPt
// Versão com painel admin, moderação e sessões

const { createClient } = window.supabase;

const db = createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

window._supabase = db;
console.log('✅ Supabase ligado —', window.SUPABASE_URL);

let currentUser  = null;
let favoritesIds = [];

db.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user ?? null;
  if (currentUser) {
    registarAcesso(currentUser.id);
    favoritesIds = await getFavoriteIds();
    const profile = await getProfile();
    if (profile) {
      const n = document.getElementById('profile-name');
      const e = document.getElementById('profile-email');
      if (n) n.textContent = profile.nome || currentUser.email?.split('@')[0] || 'Utilizador';
      if (e) e.textContent = currentUser.email || '';
    }
    if (typeof checkAdmin === 'function') checkAdmin(currentUser);
    await window.loadDBEvents();
    if (typeof showScreen === 'function') { showScreen('app'); initApp(); }
  } else {
    if (typeof showScreen === 'function') showScreen('auth');
  }
});

async function registarAcesso(userId) {
  try {
    const dispositivo = /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS'
      : /Android/i.test(navigator.userAgent) ? 'Android' : 'Web';
    await db.from('user_sessions').insert({ user_id: userId, dispositivo });
  } catch(e) {}
}

window.doLogin = async function() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { showToast('⚠️ Preenche email e senha'); return; }
  const btn = document.querySelector('#login-form .btn-primary');
  if (btn) { btn.textContent = 'A entrar...'; btn.disabled = true; }
  try {
    const { error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    showToast('✅ Bem-vindo de volta!');
  } catch(e) {
    showToast('❌ ' + translateError(e.message));
  } finally {
    if (btn) { btn.textContent = 'Entrar no app'; btn.disabled = false; }
  }
};

window.doSignup = async function() {
  const nome  = document.getElementById('signup-name')?.value?.trim();
  const email = document.getElementById('signup-email')?.value?.trim();
  const pass  = document.getElementById('signup-pass')?.value;
  if (!nome || !email || !pass) { showToast('⚠️ Preenche todos os campos'); return; }
  if (pass.length < 6) { showToast('⚠️ Senha mínimo 6 caracteres'); return; }
  const btn = document.querySelector('#signup-form .btn-primary');
  if (btn) { btn.textContent = 'A criar...'; btn.disabled = true; }
  try {
    const { error } = await db.auth.signUp({ email, password: pass, options: { data: { full_name: nome } } });
    if (error) throw error;
    showToast('🎉 Conta criada! Verifica o teu email.');
  } catch(e) {
    showToast('❌ ' + translateError(e.message));
  } finally {
    if (btn) { btn.textContent = 'Criar conta grátis'; btn.disabled = false; }
  }
};

window.googleLogin = async function() {
  const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) showToast('❌ Erro Google: ' + error.message);
};

window.logout = async function() {
  await db.auth.signOut();
  currentUser = null;
  showToast('👋 Até logo!');
};

function translateError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Email ou senha incorretos';
  if (msg.includes('Email not confirmed'))        return 'Confirma o teu email primeiro';
  if (msg.includes('User already registered'))    return 'Email já registado';
  return msg;
}

async function getProfile() {
  if (!currentUser) return null;
  const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  return data;
}

window.loadDBEvents = async function() {
  try {
    const { data, error } = await db
      .from('events')
      .select('*')
      .eq('status', 'approved')
      .gt('data_hora', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('data_hora', { ascending: true })
      .limit(100);

    if (error || !data?.length) return;

    const converted = data.map(ev => ({
      id: ev.id, name: ev.nome, genre: ev.genero,
      emoji: ev.emoji || '🎉',
      dateObj: new Date(ev.data_hora),
      date: typeof formatEventDate === 'function' ? formatEventDate(new Date(ev.data_hora)) : ev.data_hora,
      venue: ev.local + (ev.endereco ? ' · ' + ev.endereco : ''),
      dist: parseFloat((Math.random() * 8 + 0.5).toFixed(1)),
      going: String(ev.going_count || Math.floor(Math.random() * 400 + 50)),
      price: ev.preco || 'Grátis',
      source: ev.fonte || 'EventosPt',
      url: ev.url_ingresso || null,
      c1: ev.cor1 || '#0e1118', c2: ev.cor2 || '#312e81',
      recommended: ev.recomendado || false,
      tags: [ev.genero], fromDB: true,
    }));

    if (typeof EVENTS !== 'undefined') {
      converted.forEach(ev => { if (!EVENTS.find(e => e.id === ev.id)) EVENTS.push(ev); });
    }
    if (typeof applyFilters === 'function') applyFilters();
    console.log('✅ ' + data.length + ' eventos aprovados carregados');
  } catch(err) { console.warn('⚠️ Eventos locais.', err.message); }
};

window.submitEventForReview = async function(eventData) {
  if (!currentUser) { showToast('⚠️ Faz login para submeter eventos'); return false; }
  try {
    await db.from('events').insert({ ...eventData, status: 'pending', submetido_por: currentUser.id, criado_por: currentUser.id });
    showToast('📨 Evento submetido! Aguarda aprovação do administrador.');
    return true;
  } catch(e) { showToast('Erro: ' + e.message); return false; }
};

window.submitManualEvent = async function() {
  const nome    = document.getElementById('manual-nome')?.value?.trim();
  const dataVal = document.getElementById('manual-data')?.value;
  const hora    = document.getElementById('manual-hora')?.value || '22:00';
  const local   = document.getElementById('manual-local')?.value?.trim();
  const end     = document.getElementById('manual-endereco')?.value?.trim();
  const genero  = document.getElementById('manual-genero')?.value?.trim();
  const preco   = document.getElementById('manual-preco')?.value?.trim();
  const url     = document.getElementById('manual-url')?.value?.trim();
  if (!nome || !dataVal || !local) { showToast('⚠️ Preenche nome, data e local'); return; }
  const ok = await window.submitEventForReview({
    nome, genero: genero || 'Evento',
    data_hora: new Date(`${dataVal}T${hora}`).toISOString(),
    local, endereco: end || null,
    preco: preco || 'Grátis', url_ingresso: url || null,
    emoji: '🎉', cor1: '#0e1118', cor2: '#312e81',
  });
  if (ok) {
    ['manual-nome','manual-local','manual-endereco','manual-genero','manual-preco','manual-url']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (typeof closeAIModal === 'function') closeAIModal();
  }
};

async function getFavoriteIds() {
  if (!currentUser) return [];
  const { data } = await db.from('favorites').select('event_id').eq('user_id', currentUser.id);
  return (data || []).map(f => f.event_id);
}

window.toggleFavById = async function(id, el) {
  if (!currentUser) { showToast('⚠️ Faz login para favoritar eventos'); return; }
  const isFav = favoritesIds.includes(id);
  if (isFav) {
    await db.from('favorites').delete().eq('user_id', currentUser.id).eq('event_id', id);
    favoritesIds = favoritesIds.filter(f => f !== id);
    el.textContent = '🤍';
    showToast('💔 Removido dos favoritos');
  } else {
    await db.from('favorites').insert({ user_id: currentUser.id, event_id: id });
    favoritesIds.push(id);
    el.textContent = '❤️';
    showToast('❤️ Adicionado aos favoritos!');
  }
};

db.channel('events-approved')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, (payload) => {
    if (payload.new.status === 'approved') {
      showToast('🎉 Novo evento: ' + payload.new.nome);
      window.loadDBEvents();
    }
  }).subscribe();

console.log('✅ EventosPt — integração completa carregada');
