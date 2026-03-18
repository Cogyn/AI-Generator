// LLM API Client – unterstützt OpenAI und Anthropic (Claude)
// Beide erlauben CORS aus dem Browser – kein Proxy nötig.
// Erweitert: Token-Tracking für Kosten-Transparenz

import type { TokenUsage, TokenTracker } from "../core/types.js";

const SETTINGS_KEY = "ai-gen-settings";

export type Provider = "openai" | "anthropic";

interface Settings {
  provider: Provider;
  apiKey: string;
  anthropicKey: string;
  model: string;
}

const DEFAULT_MODEL_OPENAI = "gpt-4o-mini";
const DEFAULT_MODEL_ANTHROPIC = "claude-sonnet-4-20250514";

// ─── Token Tracker (global, pro Pipeline-Run) ────────────────

let _tokenTracker: TokenTracker = createEmptyTracker();

// ─── Hard Limits (Sicherheitsgrenze gegen Feedback-Loops) ────

const HARD_LIMITS = {
  max_calls_per_run: 20,         // Max LLM-Calls pro Pipeline-Run
  max_tokens_per_run: 15_000,    // Max Tokens pro Pipeline-Run
  max_cost_per_run_usd: 0.50,    // Max Kosten pro Pipeline-Run
};

let _callCount = 0;

export function getHardLimits() { return { ...HARD_LIMITS }; }

export function setHardLimits(limits: Partial<typeof HARD_LIMITS>): void {
  Object.assign(HARD_LIMITS, limits);
}

function checkHardLimits(callName: string): void {
  if (_callCount >= HARD_LIMITS.max_calls_per_run) {
    throw new Error(
      `LLM-Call-Limit erreicht: ${_callCount}/${HARD_LIMITS.max_calls_per_run} Calls` +
      ` (${callName}). Pipeline gestoppt um Kosten zu begrenzen.`,
    );
  }
  if (_tokenTracker.total_tokens >= HARD_LIMITS.max_tokens_per_run) {
    throw new Error(
      `Token-Limit erreicht: ${_tokenTracker.total_tokens}/${HARD_LIMITS.max_tokens_per_run} Tokens` +
      ` (${callName}). Pipeline gestoppt um Kosten zu begrenzen.`,
    );
  }
  if (_tokenTracker.estimated_cost_usd >= HARD_LIMITS.max_cost_per_run_usd) {
    throw new Error(
      `Kosten-Limit erreicht: $${_tokenTracker.estimated_cost_usd.toFixed(4)}/$${HARD_LIMITS.max_cost_per_run_usd.toFixed(2)}` +
      ` (${callName}). Pipeline gestoppt um Kosten zu begrenzen.`,
    );
  }
}

function createEmptyTracker(): TokenTracker {
  return {
    calls: [],
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  };
}

export function resetTokenTracker(): void {
  _tokenTracker = createEmptyTracker();
  _callCount = 0;
}

export function getTokenTracker(): TokenTracker {
  return { ..._tokenTracker, calls: [..._tokenTracker.calls] };
}

function recordTokenUsage(usage: TokenUsage): void {
  _tokenTracker.calls.push(usage);
  _tokenTracker.total_prompt_tokens += usage.prompt_tokens;
  _tokenTracker.total_completion_tokens += usage.completion_tokens;
  _tokenTracker.total_tokens += usage.total_tokens;

  // Kosten-Schätzung (grob, basierend auf gängigen Preisen)
  const settings = getSettings();
  _tokenTracker.estimated_cost_usd = estimateCost(
    _tokenTracker.total_prompt_tokens,
    _tokenTracker.total_completion_tokens,
    settings.provider,
    settings.model,
  );
}

function estimateCost(
  promptTokens: number,
  completionTokens: number,
  provider: Provider,
  model: string,
): number {
  // Preise pro 1M Tokens (Stand 2025, grobe Schätzung)
  let inputPricePerMil: number;
  let outputPricePerMil: number;

  if (provider === "anthropic") {
    if (model.includes("opus")) {
      inputPricePerMil = 15; outputPricePerMil = 75;
    } else if (model.includes("haiku")) {
      inputPricePerMil = 0.80; outputPricePerMil = 4;
    } else {
      // Sonnet
      inputPricePerMil = 3; outputPricePerMil = 15;
    }
  } else {
    if (model.includes("gpt-4o-mini")) {
      inputPricePerMil = 0.15; outputPricePerMil = 0.60;
    } else if (model.includes("gpt-4o")) {
      inputPricePerMil = 2.50; outputPricePerMil = 10;
    } else {
      inputPricePerMil = 2.50; outputPricePerMil = 10;
    }
  }

  return (promptTokens / 1_000_000) * inputPricePerMil +
    (completionTokens / 1_000_000) * outputPricePerMil;
}

// ─── Settings ─────────────────────────────────────────────────

export function getSettings(): Settings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { provider: "openai", apiKey: "", anthropicKey: "", model: DEFAULT_MODEL_OPENAI };
  const parsed = JSON.parse(raw);
  return {
    provider: parsed.provider ?? "openai",
    apiKey: parsed.apiKey ?? "",
    anthropicKey: parsed.anthropicKey ?? "",
    model: parsed.model ?? DEFAULT_MODEL_OPENAI,
  };
}

export function saveSettings(settings: Partial<Settings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

export function hasApiKey(): boolean {
  const s = getSettings();
  if (s.provider === "anthropic") return s.anthropicKey.length > 0;
  return s.apiKey.length > 0;
}

export function getActiveProvider(): Provider {
  return getSettings().provider;
}

// ─── Einheitlicher LLM-Call (bestehend, unverändert) ─────────

export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
): Promise<string> {
  // Hard-Limit-Check auch für ungetrackte Calls
  checkHardLimits("callLLM");
  _callCount++;

  const settings = getSettings();

  if (settings.provider === "anthropic") {
    return callAnthropic(settings.anthropicKey, settings.model, systemPrompt, userMessage, maxTokens);
  }
  return callOpenAI(settings.apiKey, settings.model, systemPrompt, userMessage, maxTokens);
}

// ─── LLM-Call mit Token-Tracking ─────────────────────────────

export async function callLLMTracked(
  systemPrompt: string,
  userMessage: string,
  callName: string,
  maxTokens = 1024,
): Promise<string> {
  // Hard-Limit-Check VOR dem API-Call
  checkHardLimits(callName);
  _callCount++;

  const settings = getSettings();

  if (settings.provider === "anthropic") {
    return callAnthropicTracked(settings.anthropicKey, settings.model, systemPrompt, userMessage, callName, maxTokens);
  }
  return callOpenAITracked(settings.apiKey, settings.model, systemPrompt, userMessage, callName, maxTokens);
}

// ─── OpenAI ─────────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
): Promise<string> {
  if (!apiKey) throw new Error("Kein OpenAI API Key gesetzt. Bitte in den Einstellungen eintragen.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOpenAITracked(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  callName: string,
  maxTokens = 1024,
): Promise<string> {
  if (!apiKey) throw new Error("Kein OpenAI API Key gesetzt. Bitte in den Einstellungen eintragen.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();

  // Token-Usage tracken
  if (data.usage) {
    recordTokenUsage({
      prompt_tokens: data.usage.prompt_tokens ?? 0,
      completion_tokens: data.usage.completion_tokens ?? 0,
      total_tokens: data.usage.total_tokens ?? 0,
      call_name: callName,
      timestamp: Date.now(),
    });
  }

  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Anthropic (Claude) ─────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
): Promise<string> {
  if (!apiKey) throw new Error("Kein Anthropic API Key gesetzt. Bitte in den Einstellungen eintragen.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: any) => b.type === "text");
  const raw = textBlock?.text ?? "";
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return jsonMatch[1].trim();
  return raw;
}

async function callAnthropicTracked(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  callName: string,
  maxTokens = 1024,
): Promise<string> {
  if (!apiKey) throw new Error("Kein Anthropic API Key gesetzt. Bitte in den Einstellungen eintragen.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();

  // Token-Usage tracken (Anthropic gibt usage im Response)
  if (data.usage) {
    recordTokenUsage({
      prompt_tokens: data.usage.input_tokens ?? 0,
      completion_tokens: data.usage.output_tokens ?? 0,
      total_tokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
      call_name: callName,
      timestamp: Date.now(),
    });
  }

  const textBlock = data.content?.find((b: any) => b.type === "text");
  const raw = textBlock?.text ?? "";
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return jsonMatch[1].trim();
  return raw;
}
