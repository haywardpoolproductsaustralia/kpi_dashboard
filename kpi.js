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

  // POST — save section data + notes
  if (req.method === 'POST') {
    try {
      const { weekEnding, section, submittedBy, metrics } = req.body;
      if (!weekEnding || !section || !metrics) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const notes = {};
      const numericMetrics = {};
      const noteFields = ['CurrentActions', 'RequirementsFromOthers'];
      Object.keys(metrics).forEach(k => {
        if (noteFields.includes(k)) notes[k] = metrics[k];
        else numericMetrics[k] = metrics[k];
      });
      const value = JSON.stringify({ submittedBy, submittedAt: new Date().toISOString(), metrics: numericMetrics, notes });
      await redis('hset', `kpi:${weekEnding}`, section, value);
      await redis('zadd', 'kpi:weeks', new Date(weekEnding).getTime(), weekEnding);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — either all weeks, or a specific week+section for prefill
  if (req.method === 'GET') {
    const { week, section } = req.query;

    // Section-specific GET for prefilling the form
    if (week && section) {
      try {
        const result = await redis('hget', `kpi:${week}`, section);
        if (!result.result) return res.status(200).json({ metrics: {}, notes: {} });
        const data = JSON.parse(result.result);
        var notes = data.notes || {};
        // Ensure newlines in notes are real newlines, not escaped
        Object.keys(notes).forEach(function(k) {
          if (typeof notes[k] === 'string') {
            notes[k] = notes[k].replace(/\\n/g, '\n');
          }
        });
        return res.status(200).json({ metrics: data.metrics || {}, notes: notes, submittedBy: data.submittedBy });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Full data GET — all weeks merged
    try {
      const weeksResult = await redis('zrange', 'kpi:weeks', '0', '-1');
      const weeks = weeksResult.result || [];
      const allData = [];
      for (const weekEnding of weeks) {
        const hashResult = await redis('hgetall', `kpi:${weekEnding}`);
        const hash = hashResult.result;
        if (!hash) continue;
        const mergedMetrics = {}, sections = {}, sectionNotes = {};
        for (let i = 0; i < hash.length; i += 2) {
          const sec = hash[i];
          const data = JSON.parse(hash[i + 1]);
          sections[sec] = data.submittedBy;
          Object.assign(mergedMetrics, data.metrics || {});
          if (data.notes && Object.keys(data.notes).length > 0) {
            var notes = data.notes;
            Object.keys(notes).forEach(function(k) {
              if (typeof notes[k] === 'string') notes[k] = notes[k].replace(/\\n/g, '\n');
            });
            sectionNotes[sec] = notes;
          }
        }
        const d = new Date(weekEnding + 'T00:00:00');
        const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
        allData.push({ weekEnding, weekLabel: label, metrics: mergedMetrics, sections, notes: sectionNotes });
      }
      return res.status(200).json({ weeks: allData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
