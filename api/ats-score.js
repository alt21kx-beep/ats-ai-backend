const GEMINI_MODEL = 'gemini-2.5-flash';

function normalize(text = '') {
  return String(text).toLowerCase().replace(/[^a-z0-9+#./\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractKeywords(text = '') {
  const stopWords = new Set('the and for with from that this you your are will have has was were our their they into about work role job candidate company team using use able such all any can who what when where how why must should would could experience years skills responsibilities requirements including across within plus to in of a an on at by be is as or it we us i me my he she them his her its'.split(' '));
  const words = normalize(text).split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  return [...new Set(words)].slice(0, 60);
}

function localATS(resumeText = '', jobDescription = '') {
  const jobKeywords = extractKeywords(jobDescription);
  const resume = normalize(resumeText);
  const matchedKeywords = jobKeywords.filter(k => resume.includes(k));
  const missingKeywords = jobKeywords.filter(k => !resume.includes(k));
  const keywordPercent = jobKeywords.length ? Math.round((matchedKeywords.length / jobKeywords.length) * 100) : 0;
  const sections = ['summary', 'experience', 'education', 'skills', 'projects', 'certifications'];
  const structurePercent = Math.round((sections.filter(s => resume.includes(s)).length / sections.length) * 100);
  let readabilityPercent = 100;
  if (resumeText.length < 900) readabilityPercent -= 25;
  if (resumeText.length > 7500) readabilityPercent -= 8;
  readabilityPercent = Math.max(0, Math.min(100, readabilityPercent));
  const score = Math.round(keywordPercent * 0.65 + structurePercent * 0.2 + readabilityPercent * 0.15);
  return {
    score,
    keywordPercent,
    structurePercent,
    readabilityPercent,
    matchedKeywords,
    missingKeywords,
    summary: `Local ATS score generated. Matched ${matchedKeywords.length} keywords and missed ${missingKeywords.length}.`,
    feedback: 'Local ATS scoring used because AI was unavailable.',
    suggestions: [
      'Add missing job-description keywords naturally if they are truthful.',
      'Use clear Skills, Experience, Education, Projects, and Certifications sections.',
      'Add measurable achievements with numbers, percentages, timelines, and outcomes.'
    ],
    aiConnected: false
  };
}

function extractJson(text = '') {
  const cleaned = String(text).replace(/```json/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing in Vercel environment variables.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini API request failed.');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  try {
    const { resumeText = '', jobDescription = '', jobTitle = '' } = req.body || {};
    if (!resumeText.trim() || !jobDescription.trim()) {
      return res.status(400).json({ error: 'resumeText and jobDescription are required.' });
    }

    const local = localATS(resumeText, jobDescription);

    const prompt = `
You are an ATS resume scoring engine.
Analyze the resume against the job description.
Return ONLY valid JSON. No markdown.

Required schema:
{
  "score": 0,
  "summary": "",
  "feedback": "",
  "matchedKeywords": [],
  "missingKeywords": [],
  "suggestions": [],
  "keywordPercent": 0,
  "structurePercent": 0,
  "readabilityPercent": 0
}

Rules:
- Score must be 0 to 100.
- Do not invent skills.
- Missing keywords must come from the job description.
- Suggestions must be practical resume improvements.

Job title:
${jobTitle || 'Not provided'}

Resume:
${resumeText.slice(0, 12000)}

Job description:
${jobDescription.slice(0, 7000)}

Local baseline:
${JSON.stringify(local)}
`;

    const aiText = await callGemini(prompt);
    const ai = extractJson(aiText);

    return res.status(200).json({
      ...local,
      ...ai,
      score: Math.max(0, Math.min(100, Math.round(Number(ai.score ?? local.score)))),
      keywordPercent: Math.max(0, Math.min(100, Math.round(Number(ai.keywordPercent ?? local.keywordPercent)))),
      structurePercent: Math.max(0, Math.min(100, Math.round(Number(ai.structurePercent ?? local.structurePercent)))),
      readabilityPercent: Math.max(0, Math.min(100, Math.round(Number(ai.readabilityPercent ?? local.readabilityPercent)))),
      aiConnected: true,
      provider: 'Google Gemini',
      model: GEMINI_MODEL
    });
  } catch (err) {
    const fallback = localATS(req.body?.resumeText || '', req.body?.jobDescription || '');
    return res.status(200).json({
      ...fallback,
      aiConnected: false,
      feedback: `Gemini AI failed: ${err.message}`
    });
  }
}
