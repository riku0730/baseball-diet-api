// 管理者用：全ユーザーのログイン状況・登録名・成績を集計して返す。
// service_role キーを使うため必ずサーバー側のみ。x-admin-token / ?token= で保護する。
// 必要な環境変数: ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['x-admin-token'] || req.query.token;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || token !== adminToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です' });
  }

  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  try {
    // 1. 認証ユーザー（メール・登録日・最終ログイン日時）
    const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: sbHeaders });
    if (!usersRes.ok) throw new Error(`auth users ${usersRes.status}: ${(await usersRes.text()).slice(0, 200)}`);
    const usersJson = await usersRes.json();
    const users = usersJson.users || [];

    // 2. プロフィール（名前・プレースタイル・課金等）
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=user_id,data,updated_at`, { headers: sbHeaders });
    const profiles = profRes.ok ? await profRes.json() : [];

    // 3. シーズン成績
    const seasonRes = await fetch(`${SUPABASE_URL}/rest/v1/season_stats?select=user_id,data`, { headers: sbHeaders });
    const seasons = seasonRes.ok ? await seasonRes.json() : [];

    const profMap = {};
    for (const p of (Array.isArray(profiles) ? profiles : [])) profMap[p.user_id] = p;
    const seasonMap = {};
    for (const s of (Array.isArray(seasons) ? seasons : [])) seasonMap[s.user_id] = s.data || {};

    const rows = users.map((u) => {
      const prof = profMap[u.id]?.data || {};
      const season = seasonMap[u.id] || {};
      const atBats = season.totalAtBats ?? 0;
      const hits = season.totalHits ?? 0;
      const appearances = season.pitchingAppearances ?? 0;
      return {
        email: u.email || '(なし)',
        name: prof.name || '(未設定)',
        createdAt: u.created_at || null,
        lastSignIn: u.last_sign_in_at || null,
        seasonStart: prof.seasonStartDate || null,
        playStyle: prof.playStyle || null,
        totalWar: round3(season.totalWar ?? prof.totalWar ?? 0),
        games: season.gamesPlayed ?? prof.gamesPlayed ?? 0,
        avg: atBats > 0 ? (hits / atBats) : null,
        hr: season.homeRuns ?? 0,
        // 投手成績
        era: appearances > 0 ? round2(season.era ?? 0) : null,
        wins: season.wins ?? 0,
        losses: season.losses ?? 0,
        strikeouts: season.strikeouts ?? 0,
        appearances,
        subscribed: !!prof.isSubscribed,
        lastBackup: profMap[u.id]?.updated_at || null,
      };
    });

    // 最終ログインの新しい順
    rows.sort((a, b) => (b.lastSignIn || '').localeCompare(a.lastSignIn || ''));

    // 4. 日記（アピール）一覧 — 本文があるものだけ新しい順
    const recRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_records?select=user_id,date,data&order=date.desc&limit=400`, { headers: sbHeaders });
    const recs = recRes.ok ? await recRes.json() : [];
    const diaries = [];
    for (const r of (Array.isArray(recs) ? recs : [])) {
      const text = r.data?.appealText;
      if (text && String(text).trim()) {
        diaries.push({
          name: profMap[r.user_id]?.data?.name || '(未設定)',
          date: r.date,
          text: String(text),
          reply: r.data?.appealMessage || '',
          war: r.data?.appealWar ?? 0,
        });
      }
      if (diaries.length >= 100) break;
    }

    return res.status(200).json({ count: rows.length, generatedAt: new Date().toISOString(), users: rows, diaries });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
