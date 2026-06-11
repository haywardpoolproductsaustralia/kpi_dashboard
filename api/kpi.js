// /api/kpi.js — Vercel serverless function
// Reads and writes KPI data to Upstash Redis

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${command}/${args.map(a => encodeURIComponent(a)).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — save a week's section data
  if (req.method === 'POST') {
    try {
      const { weekEnding, section, submittedBy, metrics } = req.body;
      if (!weekEnding || !section || !metrics) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Store as hash: key = kpi:{weekEnding}  field = {section}
      const value = JSON.stringify({ submittedBy, submittedAt: new Date().toISOString(), metrics });
      await redis('hset', `kpi:${weekEnding}`, section, value);

      // Track week index
      await redis('zadd', 'kpi:weeks', new Date(weekEnding).getTime(), weekEnding);

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — return all weeks of data
  if (req.method === 'GET') {
    try {
      // Get all week keys sorted by date
      const weeksResult = await redis('zrange', 'kpi:weeks', '0', '-1');
      const weeks = weeksResult.result || [];

      const allData = [];
      for (const weekEnding of weeks) {
        const hashResult = await redis('hgetall', `kpi:${weekEnding}`);
        const hash = hashResult.result;
        if (!hash) continue;

        // Merge all sections for this week into one metrics object
        const merged = {};
        const sections = {};
        for (let i = 0; i < hash.length; i += 2) {
          const section = hash[i];
          const data = JSON.parse(hash[i + 1]);
          sections[section] = data.submittedBy;
          Object.assign(merged, data.metrics);
        }

        const d = new Date(weekEnding + 'T00:00:00');
        const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });

        allData.push({ weekEnding, weekLabel: label, metrics: merged, sections });
      }

      return res.status(200).json({ weeks: allData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove a specific week+section entry
  if (req.method === 'DELETE') {
    try {
      const { weekEnding, section } = req.body;
      await redis('hdel', `kpi:${weekEnding}`, section);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
