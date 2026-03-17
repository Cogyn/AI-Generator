import { initRenderer, syncScene, clearRenderer } from "./renderer/preview.js";
import { startPipeline, extendPipeline, nextStep, getPipelineState, type PipelineState } from "./generator/pipeline.js";
import { runParallelPipeline } from "./generator/parallel/index.js";
import { loadScene, clearScene, undo, canUndo, clearUndo, saveScene } from "./core/scene.js";
import { getSettings, saveSettings, hasApiKey } from "./ai/client.js";
import type { Scene } from "./core/types.js";

// DOM Elements
const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
const extendBtn = document.getElementById("extend-btn") as HTMLButtonElement;
const stepBtn = document.getElementById("step-btn") as HTMLButtonElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLDivElement;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const saveSettingsBtn = document.getElementById("save-settings") as HTMLButtonElement;
const closeSettingsBtn = document.getElementById("close-settings") as HTMLButtonElement;
const parallelToggle = document.getElementById("parallel-toggle") as HTMLInputElement;
const planSection = document.getElementById("plan-section") as HTMLElement;
const planDisplay = document.getElementById("plan-display") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const primitiveCountEl = document.getElementById("primitive-count") as HTMLSpanElement;
const stepCountEl = document.getElementById("step-count") as HTMLSpanElement;

// Track current scene for extend functionality
let currentScene: Scene | null = null;

// Restore parallel toggle state from localStorage
const savedParallel = localStorage.getItem("ai-gen-parallel");
if (savedParallel === "true") parallelToggle.checked = true;
parallelToggle.addEventListener("change", () => {
  localStorage.setItem("ai-gen-parallel", String(parallelToggle.checked));
  stepBtn.disabled = parallelToggle.checked || stepBtn.disabled;
});

function isParallelMode(): boolean {
  return parallelToggle.checked;
}

// Init
initRenderer(canvas);

// Restore scene from localStorage
const savedScene = loadScene();
if (savedScene) {
  currentScene = savedScene;
  syncScene(savedScene);
  updateInfo(savedScene);
  updateExtendButton();
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

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});

// --- Neu generieren (ersetzt alles) ---
generateBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  if (!checkApiKey()) return;

  setGenerating(true, "generate");
  clearRenderer();
  clearScene();
  currentScene = null;
  logEl.innerHTML = "";

  try {
    if (isParallelMode()) {
      const result = await runParallelPipeline(prompt, undefined, {}, log, onStep);
      currentScene = result.scene;
      syncScene(result.scene);
      updateInfo(result.scene);
      updateExtendButton();
      updateUndoButton();
      showParallelPlan(result.partition, result.qualityScore);
    } else {
      await startPipeline(prompt, { maxSteps: 10, autoRun: true }, log, onStep);
      finishPipeline();
    }
  } catch (err) {
    log(`Fehler: ${(err as Error).message}`, "error");
  } finally {
    setGenerating(false, "generate");
    updateUndoButton();
  }
});

// --- Erweitern (baut auf bestehender Scene auf) ---
extendBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt || !currentScene) return;
  if (!checkApiKey()) return;

  setGenerating(true, "extend");
  logEl.innerHTML = "";

  try {
    if (isParallelMode()) {
      const result = await runParallelPipeline(prompt, currentScene, {}, log, onStep);
      currentScene = result.scene;
      syncScene(result.scene);
      updateInfo(result.scene);
      updateExtendButton();
      updateUndoButton();
      showParallelPlan(result.partition, result.qualityScore);
    } else {
      await extendPipeline(prompt, currentScene, { maxSteps: 10, autoRun: true }, log, onStep);
      finishPipeline();
    }
  } catch (err) {
    log(`Fehler: ${(err as Error).message}`, "error");
  } finally {
    setGenerating(false, "extend");
    updateUndoButton();
  }
});

// --- Manual Step ---
stepBtn.addEventListener("click", async () => {
  if (!hasApiKey()) return;

  stepBtn.disabled = true;
  try {
    const state = await nextStep(log, onStep);
    if (state) {
      currentScene = state.scene;
      updatePlan(state);
      updateInfo(state.scene);
      stepBtn.disabled = state.isComplete;
      updateExtendButton();
    }
  } catch (err) {
    log(`Fehler: ${(err as Error).message}`, "error");
  }
});

// --- Undo ---
undoBtn.addEventListener("click", () => {
  const prev = undo();
  if (prev) {
    currentScene = prev;
    syncScene(prev);
    saveScene(prev);
    updateInfo(prev);
    updateExtendButton();
    updateUndoButton();
    log("Undo durchgeführt", "info");
  }
});

// --- Reset ---
resetBtn.addEventListener("click", () => {
  clearRenderer();
  clearScene();
  clearUndo();
  currentScene = null;
  planSection.classList.add("hidden");
  logEl.innerHTML = "";
  stepBtn.disabled = true;
  undoBtn.disabled = true;
  updateInfo(null);
  updateExtendButton();
  log("Scene zurückgesetzt", "info");
});

// --- Helpers ---

function checkApiKey(): boolean {
  if (!hasApiKey()) {
    settingsModal.classList.remove("hidden");
    log("Bitte zuerst API Key eingeben", "warn");
    return false;
  }
  return true;
}

function finishPipeline(): void {
  const state = getPipelineState();
  if (state) {
    currentScene = state.scene;
    updatePlan(state);
    updateInfo(state.scene);
    stepBtn.disabled = state.isComplete;
    updateExtendButton();
  }
}

function onStep(scene: Scene, _stepNum: number): void {
  currentScene = scene;
  syncScene(scene);
  updateInfo(scene);
  updateExtendButton();
  updateUndoButton();
}

function updateInfo(scene: Scene | null): void {
  const count = scene?.primitives.length ?? 0;
  const steps = scene?.metadata.stepCount ?? 0;
  primitiveCountEl.textContent = `${count} Primitive${count !== 1 ? "s" : ""}`;
  stepCountEl.textContent = `Schritt ${steps}`;
}

function updateExtendButton(): void {
  extendBtn.disabled = !currentScene || currentScene.primitives.length === 0;
}

function updateUndoButton(): void {
  undoBtn.disabled = !canUndo();
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

function showParallelPlan(partition: import("./core/types.js").ScenePartition, qualityScore: number): void {
  planSection.classList.remove("hidden");
  const regionsHtml = partition.regions.map((r) => {
    const assignment = partition.assignments.find((a) => a.regionId === r.id);
    return `<div class="plan-region"><span class="plan-region-label">${r.label}</span><span class="plan-region-goal"> — ${assignment?.localGoal ?? ""}</span></div>`;
  }).join("");

  const pct = Math.round(qualityScore * 100);
  const cls = pct >= 70 ? "good" : pct >= 40 ? "ok" : "bad";
  const qualityHtml = `<div class="plan-quality ${cls}">Quality: ${pct}%</div>`;

  planDisplay.innerHTML = regionsHtml + qualityHtml;
}

function log(msg: string, level: "info" | "success" | "warn" | "error" = "info"): void {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  entry.textContent = msg;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function setGenerating(active: boolean, mode: "generate" | "extend"): void {
  generateBtn.disabled = active;
  extendBtn.disabled = active;
  if (mode === "generate") {
    generateBtn.textContent = active ? "Generiert..." : "Neu generieren";
    if (active) generateBtn.classList.add("generating");
    else generateBtn.classList.remove("generating");
  } else {
    extendBtn.textContent = active ? "Erweitert..." : "Erweitern";
    if (active) extendBtn.classList.add("generating");
    else extendBtn.classList.remove("generating");
  }
}
