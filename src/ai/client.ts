// OpenAI API Client
// OpenAI erlaubt CORS aus dem Browser – kein Proxy nötig.

const SETTINGS_KEY = "ai-gen-settings";

interface Settings {
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";

export function getSettings(): Settings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { apiKey: "", model: DEFAULT_MODEL };
  const parsed = JSON.parse(raw);
  return { apiKey: parsed.apiKey ?? "", model: parsed.model ?? DEFAULT_MODEL };
}

export function saveSettings(settings: Partial<Settings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

export function hasApiKey(): boolean {
  return getSettings().apiKey.length > 0;
}

export async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const { apiKey, model } = getSettings();
  if (!apiKey) throw new Error("Kein API Key gesetzt. Bitte in den Einstellungen eintragen.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
