import { AIResult } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// Paste your OpenAI API key here (from platform.openai.com/api-keys).
// For production, proxy requests through your own backend instead of storing
// the key in the app bundle.
// ---------------------------------------------------------------------------
const OPENAI_API_KEY = 'sk-...AE4A';
const OPENAI_MODEL = 'gpt-4o-mini'; // fast & cheap for real-time use
const API_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a reading assistant for smart glasses. The user's glasses scan printed text
using OCR and send it to you. Your job is to:

1. CLEAN the text: Fix obvious OCR errors (wrong letters, split words, stray symbols).
   Keep the meaning intact — do not add information that wasn't there.
2. DETECT: Decide if the cleaned text is a question (ends with "?" or is phrased as a question).
3. ANSWER: If it is a question, provide a concise, clear answer (1–3 sentences max).
   If it is not a question, do not answer — just return the cleaned text.

Always respond with valid JSON in this exact shape:
{
  "cleanedText": "<the corrected text>",
  "isQuestion": true | false,
  "answer": "<your answer, or null if not a question>"
}`;

export async function processOCRText(rawText: string): Promise<AIResult> {
  if (!rawText.trim()) {
    return { cleanedText: '', isQuestion: false };
  }

  const body = {
    model: OPENAI_MODEL,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `OCR text from the glasses:\n"${rawText}"` },
    ],
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  const parsed = JSON.parse(content);
  return {
    cleanedText: parsed.cleanedText ?? rawText,
    isQuestion: Boolean(parsed.isQuestion),
    answer: parsed.answer ?? undefined,
  };
}
