// Settings come from environment variables (see .env.example).
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/graphrag',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  embedModel: process.env.EMBED_MODEL ?? 'nomic-embed-text',
  llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'deepseek-flash',
  tokenBudget: Number(process.env.TOKEN_BUDGET ?? 2_000_000),
}
