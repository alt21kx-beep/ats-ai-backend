export default function handler(req, res) {
  res.status(200).json({
    server: 'ok',
    provider: 'Google Gemini',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    endpoints: ['/api/health', '/api/ats-score']
  });
}
