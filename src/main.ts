import { initRenderer, syncScene, clearRenderer } from "./renderer/preview.js";
import { startPipeline, nextStep, getPipelineState, type PipelineState } from "./generator/pipeline.js";
import { loadScene, clearScene } from "./core/scene.js";
import { getSettings, saveSettings, hasApiKey } from "./ai/client.js";
import type { Scene } from "./core/types.js";

// DOM Elements
const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
const stepBtn = document.getElementById("step-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLDivElement;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const saveSettingsBtn = document.getElementById("save-settings") as HTMLButtonElement;
const closeSettingsBtn = document.getElementById("close-settings") as HTMLButtonElement;
const planSection = document.getElementById("plan-section") as HTMLElement;
const planDisplay = document.getElementById("plan-display") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const primitiveCountEl = document.getElementById("primitive-count") as HTMLSpanElement;
const stepCountEl = document.getElementById("step-count") as HTMLSpanElement;

// Init
initRenderer(canvas);

// Restore scene from localStorage
const savedScene = loadScene();
if (savedScene) {
  syncScene(savedScene);
  updateInfo(savedScene);
}

// Restore API key
const settings = getSettings();
if (settings.apiKey) {
  apiKeyInput.value = settings.apiKey;
}

// --- Settings ---
settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
  const s = getSettings();
  apiKeyInput.value = s.apiKey;
  modelSelect.value = s.model;
});

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", () => {
  saveSettings({ apiKey: apiKeyInput.value.trim(), model: modelSelect.value });
  settingsModal.classList.add("hidden");
  log(`Einstellungen gespeichert (${modelSelect.value})`, "success");
});

// Close modal on backdrop click
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});

// --- Generate ---
generateBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  if (!hasApiKey()) {
    settingsModal.classList.remove("hidden");
    log("Bitte zuerst API Key eingeben", "warn");
    return;
  }

  setGenerating(true);
  clearRenderer();
  clearScene();
  logEl.innerHTML = "";

  try {
    await startPipeline(
      prompt,
      { maxSteps: 10, autoRun: true },
      log,
      onStep,
    );

    const state = getPipelineState();
    if (state) {
      updatePlan(state);
      updateInfo(state.scene);
      stepBtn.disabled = state.isComplete;
    }
  } catch (err) {
    log(`Fehler: ${(err as Error).message}`, "error");
  } finally {
    setGenerating(false);
  }
});

// --- Manual Step ---
stepBtn.addEventListener("click", async () => {
  if (!hasApiKey()) return;

  stepBtn.disabled = true;
  try {
    const state = await nextStep(log, onStep);
    if (state) {
      updatePlan(state);
      updateInfo(state.scene);
      stepBtn.disabled = state.isComplete;
    }
  } catch (err) {
    log(`Fehler: ${(err as Error).message}`, "error");
  }
});

// --- Reset ---
resetBtn.addEventListener("click", () => {
  clearRenderer();
  clearScene();
  planSection.classList.add("hidden");
  logEl.innerHTML = "";
  stepBtn.disabled = true;
  updateInfo(null);
  log("Scene zurückgesetzt", "info");
});

// --- Helpers ---

function onStep(scene: Scene, _stepNum: number): void {
  syncScene(scene);
  updateInfo(scene);
}

function updateInfo(scene: Scene | null): void {
  const count = scene?.primitives.length ?? 0;
  const steps = scene?.metadata.stepCount ?? 0;
  primitiveCountEl.textContent = `${count} Primitive${count !== 1 ? "s" : ""}`;
  stepCountEl.textContent = `Schritt ${steps}`;
}

function updatePlan(state: PipelineState): void {
  planSection.classList.remove("hidden");
  planDisplay.innerHTML = state.plan.steps
    .map((s, i) => {
      let cls = "";
      if (i < state.currentStep) cls = "done";
      else if (i === state.currentStep && !state.isComplete) cls = "active";
      return `<div class="plan-step ${cls}"><span class="plan-step-num">${i + 1}.</span> ${s}</div>`;
    })
    .join("");
}

function log(msg: string, level: "info" | "success" | "warn" | "error" = "info"): void {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  entry.textContent = msg;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function setGenerating(active: boolean): void {
  generateBtn.disabled = active;
  generateBtn.textContent = active ? "Generiert..." : "Generieren";
  if (active) generateBtn.classList.add("generating");
  else generateBtn.classList.remove("generating");
}
