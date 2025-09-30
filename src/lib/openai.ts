import OpenAI from 'openai'

const apiKey = import.meta.env.VITE_OPENAI_API_KEY
const baseURL = import.meta.env.VITE_OPENAI_BASE_URL

export const openai = new OpenAI({ apiKey, baseURL })

export function isOpenAIConfigured(): boolean {
  return Boolean(apiKey)
}


