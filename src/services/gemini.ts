/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { Message } from "../types";
import { db, auth } from "./firebase";
import {
  DEFAULT_GEMINI_MODEL,
  LIVE_GEMINI_MODELS,
  buildModelChain,
  classifyModelError,
  terminalModelMessage,
  type ModelFailureKind,
} from "../../functions/src/modelRouter";

export { DEFAULT_GEMINI_MODEL, LIVE_GEMINI_MODELS, buildModelChain };

function getProxyUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "cognitive-bridge-ai";
  
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "0.0.0.0"
  ) {
    return `http://localhost:5001/${projectId}/us-central1/chatProxy`;
  }
  return "/api/chat";
}

// Capacity (503) and retired ids (404) switch models immediately.
// Retrying the same id repeats the failure and burns the demo.
const ATTEMPT_TIMEOUT_MS = 80000;

export interface ModelInfo {
  name: string;
  version: number;
  isPro: boolean;
  isFlash: boolean;
  isLite: boolean;
  isPreview: boolean;
}

export function parseModelName(name: string): ModelInfo {
  const cleanName = name.replace(/^models\//, '').toLowerCase();
  
  // Extract version number (e.g. gemini-3.5-flash -> 3.5, gemini-3.1-pro-preview -> 3.1)
  const versionMatch = cleanName.match(/gemini-(\d+(?:\.\d+)?)/);
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
  
  const isPro = cleanName.includes('pro');
  const isFlash = cleanName.includes('flash') && !cleanName.includes('lite');
  const isLite = cleanName.includes('lite') || cleanName.includes('flash-lite');
  const isPreview = cleanName.includes('preview');
  
  return {
    name,
    version,
    isPro,
    isFlash,
    isLite,
    isPreview,
  };
}

export let activeModelsCache: string[] = [];
let isFetchingModels = false;

export async function refreshActiveModelsList(apiKey?: string) {
  // No-op: active models are configured on the backend or falling back to static lists
  return;
}

export function getDynamicModelFallbacks(requestedModel: string): string[] {
  const fullName = requestedModel.startsWith('models/') ? requestedModel : `models/${requestedModel}`;
  
  const staticProFallbacks = [...LIVE_GEMINI_MODELS];
  const staticFlashFallbacks = [...LIVE_GEMINI_MODELS];

  const getStaticFallback = (list: string[]) => {
    const fullList = list.map(m => m.startsWith('models/') ? m : `models/${m}`);
    const filtered = fullList.filter(m => m !== fullName);
    const result = [fullName, ...filtered];
    
    const originalHasPrefix = requestedModel.startsWith('models/');
    // Limit to at most 6 models to prevent excessive retry fallback loops
    return result.map(name => originalHasPrefix ? name : name.replace(/^models\//, '')).slice(0, 6);
  };

  // If cache is empty, return static fallbacks
  if (activeModelsCache.length === 0) {
    if (fullName.includes('pro')) {
      return getStaticFallback(staticProFallbacks);
    }
    return getStaticFallback(staticFlashFallbacks);
  }

  try {
    const reqInfo = parseModelName(fullName);
    const parsedCache = activeModelsCache.map(m => parseModelName(m));
    
    const proModels = parsedCache.filter(m => m.isPro);
    const flashModels = parsedCache.filter(m => m.isFlash);
    const liteModels = parsedCache.filter(m => m.isLite);
    
    const sortModels = (a: ModelInfo, b: ModelInfo) => {
      if (a.version !== b.version) {
        return b.version - a.version;
      }
      if (a.isPreview && !b.isPreview) return 1;
      if (!a.isPreview && b.isPreview) return -1;
      return 0;
    };
    
    proModels.sort(sortModels);
    flashModels.sort(sortModels);
    liteModels.sort(sortModels);
    
    const fallbacks: string[] = [fullName];
    
    if (reqInfo.isPro) {
      // 1. Pro models with version <= requested version
      const lowerPro = proModels.filter(m => m.version <= reqInfo.version && m.name !== fullName);
      fallbacks.push(...lowerPro.map(m => m.name));
      
      // 2. Then Flash models with version <= requested version
      const lowerFlash = flashModels.filter(m => m.version <= reqInfo.version);
      fallbacks.push(...lowerFlash.map(m => m.name));
    } else {
      // It's a Flash or Lite model
      // 1. Flash models with version <= requested version
      const lowerFlash = flashModels.filter(m => m.version <= reqInfo.version && m.name !== fullName);
      fallbacks.push(...lowerFlash.map(m => m.name));
      
      // 2. Then Lite models with version <= requested version
      const lowerLite = liteModels.filter(m => m.version <= reqInfo.version);
      fallbacks.push(...lowerLite.map(m => m.name));
      
      // 3. Then Pro models as ultimate fallbacks
      const lowerPro = proModels.filter(m => m.version <= reqInfo.version);
      fallbacks.push(...lowerPro.map(m => m.name));
    }
    
    // Absolute fallback: add remaining models to guarantee backup
    const remaining = parsedCache.filter(m => !fallbacks.includes(m.name));
    remaining.sort(sortModels);
    fallbacks.push(...remaining.map(m => m.name));
    
    const originalHasPrefix = requestedModel.startsWith('models/');
    const finalFallbacks = fallbacks.map(name => {
      return originalHasPrefix ? name : name.replace(/^models\//, '');
    });
    
    // Limit to at most 6 models to prevent excessive retry fallback loops
    return Array.from(new Set(finalFallbacks)).slice(0, 6);
  } catch (err) {
    console.error("Error building dynamic fallback list, reverting to static list:", err);
    if (fullName.includes('pro')) {
      return getStaticFallback(staticProFallbacks);
    }
    return getStaticFallback(staticFlashFallbacks);
  }
}

export function isTransientError(error: any): boolean {
  if (!error) return false;
  
  if (error.code === 503 || error.status === 503) return true;
  
  if (error.error) {
    if (error.error.code === 503 || error.error.status === 503) return true;
    if (typeof error.error.message === 'string') {
      const msg = error.error.message.toLowerCase();
      if (msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand')) {
        return true;
      }
    }
  }

  const msg = String(error.message || error).toLowerCase();
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand') || msg.includes('temporarily unavailable')) {
    return true;
  }
  
  return false;
}

export function isProjectWideError(error: any): boolean {
  if (!error) return false;
  
  const status = error.status || error.code || (error.error && (error.error.status || error.error.code));
  if (status === 403) return true;
  
  const msg = String(error.message || (error.error && error.error.message) || error).toLowerCase();
  if (
    msg.includes('spending cap') ||
    msg.includes('api key') ||
    msg.includes('billing') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('credentials')
  ) {
    return true;
  }
  
  return false;
}

export async function logTokenUsage(data: {
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  feature?: string;
}) {
  try {
    const userId = auth.currentUser?.uid || "guest";
    await addDoc(collection(db, "token_usage"), {
      userId,
      model: data.modelName,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      feature: data.feature || "unknown",
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log token usage to Firestore:", error);
  }
}

export interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
}

const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  enabled: false,
  baseUrl: "http://localhost:11434",
  model: "gemma4:e2b"
};

export function getOllamaConfig(): OllamaConfig {
  try {
    if (
      typeof window !== 'undefined' &&
      window.localStorage &&
      typeof window.localStorage.getItem === 'function'
    ) {
      const saved = window.localStorage.getItem("ollama_config");
      if (saved) {
        return { ...DEFAULT_OLLAMA_CONFIG, ...JSON.parse(saved) };
      }
    }
  } catch (e) {
    console.error("Failed to load ollama config:", e);
  }
  return DEFAULT_OLLAMA_CONFIG;
}

export function setOllamaConfig(config: OllamaConfig) {
  try {
    if (
      typeof window !== 'undefined' &&
      window.localStorage &&
      typeof window.localStorage.setItem === 'function'
    ) {
      window.localStorage.setItem("ollama_config", JSON.stringify(config));
    }
  } catch (e) {
    console.error("Failed to save ollama config:", e);
  }
}

async function chatWithOllama(
  messages: Message[],
  systemInstruction: string | undefined,
  config: OllamaConfig
): Promise<string> {
  try {
    const ollamaMessages = [];
    if (systemInstruction) {
      ollamaMessages.push({ role: "system", content: systemInstruction });
    }
    messages.forEach(m => {
      ollamaMessages.push({
        role: m.role === "model" ? "assistant" : m.role,
        content: m.content
      });
    });

    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: ollamaMessages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const data = await response.json();
    return data.message?.content || "";
  } catch (error) {
    console.error("Ollama API Error:", error);
    return `Error calling Ollama (${config.model}): ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function* chatWithOllamaStream(
  messages: Message[],
  systemInstruction: string | undefined,
  config: OllamaConfig
): AsyncGenerator<string, void, unknown> {
  try {
    const ollamaMessages = [];
    if (systemInstruction) {
      ollamaMessages.push({ role: "system", content: systemInstruction });
    }
    messages.forEach(m => {
      ollamaMessages.push({
        role: m.role === "model" ? "assistant" : m.role,
        content: m.content
      });
    });

    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: ollamaMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Ollama stream body is not readable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(cleanLine);
          } catch (e) {
            console.error("Failed to parse Ollama stream chunk:", e, "Chunk string:", cleanLine);
            continue;
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch (e) {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (finalError: any) {
    console.error("Ollama Streaming Error:", finalError);
    yield `Error connecting to Ollama stream: ${finalError.message || String(finalError)}`;
  }
}

class ProxyRequestError extends Error {
  kind: ModelFailureKind;
  exhausted: boolean;

  constructor(message: string, kind: ModelFailureKind, exhausted = false) {
    super(message);
    this.name = "ProxyRequestError";
    this.kind = kind;
    this.exhausted = exhausted;
  }
}

function shouldSwitchModel(error: unknown): boolean {
  if (error instanceof ProxyRequestError && error.exhausted) return false;
  const kind = error instanceof ProxyRequestError ? error.kind : classifyModelError(error);
  // Timeouts and dropped connections move on too. A hung model must not
  // block the rest of the chain until the UI gives up.
  return kind === "capacity" || kind === "unavailable" || isTransportBlip(error);
}

function isTransportBlip(error: unknown): boolean {
  const msg = String((error as Error)?.message || error).toLowerCase();
  return (
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

async function readProxyError(response: Response): Promise<ProxyRequestError> {
  const errorText = await response.text();
  let payload: { error?: string; fallbacksExhausted?: boolean; code?: number } | null = null;
  try {
    payload = JSON.parse(errorText);
  } catch {
    payload = null;
  }
  const message = payload?.error || errorText || `HTTP ${response.status}`;
  const wrapped = `HTTP error! status: ${response.status}, message: ${message}`;
  const kind = classifyModelError({ status: payload?.code || response.status, message: wrapped });
  return new ProxyRequestError(wrapped, kind, Boolean(payload?.fallbacksExhausted));
}

async function postChat(
  messages: Message[],
  systemInstruction: string | undefined,
  modelName: string,
  stream: boolean
): Promise<Response> {
  return fetch(getProxyUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages,
      systemInstruction,
      modelName,
      stream
    }),
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
      : undefined
  });
}

export async function chatWithGemini(
  messages: Message[],
  systemInstruction?: string,
  modelName: string = DEFAULT_GEMINI_MODEL,
  _feature?: string
): Promise<string> {
  const ollamaConfig = getOllamaConfig();
  if (ollamaConfig.enabled) {
    return chatWithOllama(messages, systemInstruction, ollamaConfig);
  }

  const models = getDynamicModelFallbacks(modelName);
  let lastError: unknown;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    try {
      const response = await postChat(messages, systemInstruction, model, false);
      if (!response.ok) {
        throw await readProxyError(response);
      }
      const data = await response.json();
      if (data.error) {
        const kind = classifyModelError(data.error);
        throw new ProxyRequestError(String(data.error), kind, Boolean(data.fallbacksExhausted));
      }
      return data.text || "";
    } catch (error) {
      lastError = error;
      const nextModel = models[index + 1];
      if (nextModel && shouldSwitchModel(error)) {
        console.warn(`Gemini model ${model} failed. Switching to ${nextModel}.`);
        continue;
      }
      break;
    }
  }

  console.error("Gemini API Error (via Proxy):", lastError);
  return "I encountered an error connecting to the intelligence bridge.";
}

export async function* chatWithGeminiStream(
  messages: Message[],
  systemInstruction?: string,
  modelName: string = DEFAULT_GEMINI_MODEL,
  _feature?: string,
  onFallback?: (failedModel: string, nextModel: string) => void
): AsyncGenerator<string, void, unknown> {
  const ollamaConfig = getOllamaConfig();
  if (ollamaConfig.enabled) {
    yield* chatWithOllamaStream(messages, systemInstruction, ollamaConfig);
    return;
  }

  const models = getDynamicModelFallbacks(modelName);
  let lastError: unknown;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    let yielded = false;
    try {
      const response = await postChat(messages, systemInstruction, model, true);
      if (!response.ok) {
        throw await readProxyError(response);
      }
      if (!response.body) {
        throw new ProxyRequestError("Response body is not readable.", "other");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine.startsWith("data: ")) continue;

            const dataStr = cleanLine.substring(6).trim();
            if (dataStr === "[DONE]") {
              return;
            }

            let parsed: any;
            try {
              parsed = JSON.parse(dataStr);
            } catch (parseError) {
              console.error("Failed to parse stream chunk:", parseError, "Chunk string:", dataStr);
              continue;
            }

            if (parsed.fallback?.from && parsed.fallback?.to && onFallback) {
              onFallback(parsed.fallback.from, parsed.fallback.to);
            }
            if (parsed.error) {
              const kind = classifyModelError(parsed.error);
              throw new ProxyRequestError(String(parsed.error), kind, Boolean(parsed.fallbacksExhausted));
            }
            if (parsed.text) {
              yielded = true;
              yield parsed.text;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return;
    } catch (error) {
      lastError = error;
      if (yielded) {
        console.error("Gemini Streaming Error (via Proxy):", error);
        return;
      }
      const nextModel = models[index + 1];
      if (nextModel && shouldSwitchModel(error)) {
        console.warn(`Gemini model ${model} failed. Switching to ${nextModel}.`);
        onFallback?.(model, nextModel);
        continue;
      }
      break;
    }
  }

  console.error("Gemini Streaming Error (via Proxy):", lastError);
  const kind = lastError instanceof ProxyRequestError
    ? lastError.kind
    : classifyModelError(lastError);
  yield terminalModelMessage(kind);
}
