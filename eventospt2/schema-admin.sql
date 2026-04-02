-- =====================================================
-- EventosPt — Atualização do Schema para Admin
-- Cola isto no SQL Editor do Supabase e clica Run
-- =====================================================

-- ─── 1. Adicionar coluna de estado aos eventos ────────
-- Os eventos agora têm 3 estados:
-- 'pending'  → submetido por utilizador, aguarda revisão
-- 'approved' → aprovado pelo admin, aparece no app
-- 'rejected' → rejeitado pelo admin

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submetido_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS nota_admin TEXT;

-- Eventos criados pelo admin ficam aprovados automaticamente
-- Eventos de utilizadores ficam pendentes
UPDATE events SET status = 'approved' WHERE status IS NULL;

-- ─── 2. Tabela de sessões / acessos diários ──────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  entrou_em   TIMESTAMPTZ DEFAULT NOW(),
  ip          TEXT,
  dispositivo TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_data_idx ON user_sessions (entrou_em);

-- ─── 3. Tabela de notificações para admin ────────────
CREATE TABLE IF NOT EXISTS admin_notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo       TEXT NOT NULL, -- 'new_event', 'new_user'
  mensagem   TEXT,
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  lida       BOOLEAN DEFAULT FALSE,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. Atualizar políticas de segurança ─────────────

-- Utilizadores só veem eventos aprovados
DROP POLICY IF EXISTS "ver_eventos" ON events;
CREATE POLICY "ver_eventos" ON events
  FOR SELECT USING (
    status = 'approved'
    OR criado_por = auth.uid()
    OR submetido_por = auth.uid()
  );

-- Utilizadores podem submeter eventos (ficam pendentes)
DROP POLICY IF EXISTS "criar_eventos" ON events;
CREATE POLICY "criar_eventos" ON events
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- Sessões — cada utilizador regista a sua
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inserir_sessao" ON user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ver_sessao" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- ─── 5. Função para registar acesso ──────────────────
CREATE OR REPLACE FUNCTION registar_acesso(p_user_id UUID, p_dispositivo TEXT DEFAULT 'web')
RETURNS void AS $$
BEGIN
  INSERT INTO user_sessions (user_id, dispositivo)
  VALUES (p_user_id, p_dispositivo);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 6. View para estatísticas do admin ──────────────
CREATE OR REPLACE VIEW admin_stats AS
SELECT
  (SELECT COUNT(*) FROM auth.users) AS total_utilizadores,
  (SELECT COUNT(*) FROM auth.users
   WHERE created_at >= NOW() - INTERVAL '24 hours') AS novos_hoje,
  (SELECT COUNT(*) FROM auth.users
   WHERE created_at >= NOW() - INTERVAL '7 days') AS novos_semana,
  (SELECT COUNT(DISTINCT user_id) FROM user_sessions
   WHERE entrou_em >= NOW() - INTERVAL '24 hours') AS acessos_hoje,
  (SELECT COUNT(DISTINCT user_id) FROM user_sessions
   WHERE entrou_em >= NOW() - INTERVAL '7 days') AS acessos_semana,
  (SELECT COUNT(*) FROM events WHERE status = 'approved') AS eventos_aprovados,
  (SELECT COUNT(*) FROM events WHERE status = 'pending') AS eventos_pendentes,
  (SELECT COUNT(*) FROM events WHERE status = 'rejected') AS eventos_rejeitados,
  (SELECT COUNT(*) FROM favorites) AS total_favoritos;

-- Permissão para admin ver a view (substitui pelo teu email)
-- GRANT SELECT ON admin_stats TO authenticated;

-- ─── 7. Notificação automática quando evento submetido ──
CREATE OR REPLACE FUNCTION notificar_admin_novo_evento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO admin_notifications (tipo, mensagem, event_id)
    VALUES (
      'new_event',
      'Novo evento para aprovação: ' || NEW.nome,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notificar_evento ON events;
CREATE TRIGGER trigger_notificar_evento
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION notificar_admin_novo_evento();

-- ─── 8. Notificação quando novo utilizador se regista ──
CREATE OR REPLACE FUNCTION notificar_admin_novo_utilizador()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO admin_notifications (tipo, mensagem)
  VALUES (
    'new_user',
    'Novo utilizador registado: ' || COALESCE(NEW.email, 'sem email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notificar_utilizador ON auth.users;
CREATE TRIGGER trigger_notificar_utilizador
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION notificar_admin_novo_utilizador();

-- ─── 9. Dados de exemplo para testar ─────────────────
-- Remove os /* */ para ativar
/*
INSERT INTO events (nome, genero, emoji, data_hora, local, lat, lng, preco, status, cor1, cor2)
VALUES
  ('Samba do Trabalhador', 'Pagode', '🥁',
   NOW() + INTERVAL '2 days',
   'The View - Trindade Bar, Porto', 41.1496, -8.6109,
   'Grátis', 'approved', '#0a1a0a', '#14532d'),

  ('Noite de Funk', 'Funk', '🎤',
   NOW() + INTERVAL '3 days',
   'Club Mau Mau, Porto', 41.1579, -8.6291,
   'R$ 20', 'approved', '#1f0a0a', '#7f1d1d'),

  ('Evento Pendente Teste', 'Rock', '🎸',
   NOW() + INTERVAL '5 days',
   'Teatro Municipal, Porto', 41.1470, -8.6150,
   'R$ 15', 'pending', '#0a0a1a', '#1e3a5f');
*/
