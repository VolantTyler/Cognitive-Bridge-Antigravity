/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { Message } from "../types";
import { db, auth } from "./firebase";

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

// Constants for retry logic
export const MAX_ATTEMPTS_PER_MODEL = 2;
export let retryDelayMs = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 0 : 1000;
export function setRetryDelayMs(ms: number) {
  retryDelayMs = ms;
}
const sleep = (ms: number) => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

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
  
  const staticProFallbacks = [
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-1.5-pro',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];
  
  const staticFlashFallbacks = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];

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

export function sanitizeAndPruneMessages(
  messages: Message[],
  maxTurns: number = 30
): Message[] {
  if (!messages || messages.length === 0) return [];

  // Filter out empty messages and ensure consistent roles
  const clean: Message[] = messages
    .filter(m => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .map(m => ({
      role: (m.role as string) === 'assistant' ? 'model' : m.role,
      content: m.content.trim()
    }));

  if (clean.length <= maxTurns) {
    return clean;
  }

  // Preserve the first user turn for task context, plus the most recent (maxTurns - 1) turns
  const firstMessage = clean[0];
  const recentSlice = clean.slice(-(maxTurns - 1));

  if (recentSlice.includes(firstMessage)) {
    return recentSlice;
  }

  return [firstMessage, ...recentSlice];
}

export function isContextLengthError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || (error.error && error.error.message) || error).toLowerCase();
  return (
    msg.includes('context length') ||
    msg.includes('token limit') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context') ||
    msg.includes('payload too large') ||
    error.status === 413 ||
    error.code === 413
  );
}

export async function chatWithGemini(
  messages: Message[],
  systemInstruction?: string,
  modelName: string = "gemini-2.5-flash",
  feature?: string,
  onFallback?: (failedModel: string, nextModel: string) => void
): Promise<string> {
  const ollamaConfig = getOllamaConfig();
  if (ollamaConfig.enabled) {
    return chatWithOllama(messages, systemInstruction, ollamaConfig);
  }

  let sanitizedMessages = sanitizeAndPruneMessages(messages);
  const candidateModels = getDynamicModelFallbacks(modelName);
  let lastError: any = null;

  for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
    const currentModel = candidateModels[modelIdx];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const url = getProxyUrl();
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: sanitizedMessages,
            systemInstruction,
            modelName: currentModel,
            stream: false
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          let parsedError: any;
          try {
            parsedError = JSON.parse(errorText);
          } catch {
            parsedError = { message: errorText };
          }
          const errObj = new Error(
            parsedError.error?.message || parsedError.message || `HTTP error! status: ${response.status}`
          );
          (errObj as any).status = response.status;
          throw errObj;
        }

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        return data.text || "";
      } catch (err: any) {
        lastError = err;
        console.warn(`[chatWithGemini] Attempt ${attempt} failed on model ${currentModel}:`, err);

        // Check if context length error: prune and retry immediately
        if (isContextLengthError(err) && sanitizedMessages.length > 4) {
          sanitizedMessages = sanitizeAndPruneMessages(sanitizedMessages, Math.floor(sanitizedMessages.length / 2));
          continue;
        }

        // If not transient and reached max attempts, break to next model
        if (!isTransientError(err) && attempt >= MAX_ATTEMPTS_PER_MODEL) {
          break;
        }

        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(retryDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    // Model exhausted - trigger fallback if another candidate exists
    if (modelIdx < candidateModels.length - 1) {
      const nextModel = candidateModels[modelIdx + 1];
      console.warn(`[chatWithGemini] Falling back from ${currentModel} to ${nextModel}`);
      onFallback?.(currentModel, nextModel);
    }
  }

  console.error("Gemini API Error (via Proxy) after all recovery attempts:", lastError);
  return "I encountered an error connecting to the intelligence bridge.";
}

export async function* chatWithGeminiStream(
  messages: Message[],
  systemInstruction?: string,
  modelName: string = "gemini-2.5-flash",
  feature?: string,
  onFallback?: (failedModel: string, nextModel: string) => void
): AsyncGenerator<string, void, unknown> {
  const ollamaConfig = getOllamaConfig();
  if (ollamaConfig.enabled) {
    yield* chatWithOllamaStream(messages, systemInstruction, ollamaConfig);
    return;
  }

  let sanitizedMessages = sanitizeAndPruneMessages(messages);
  const candidateModels = getDynamicModelFallbacks(modelName);
  let hasYieldedAnyText = false;
  let lastError: any = null;

  for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
    const currentModel = candidateModels[modelIdx];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const url = getProxyUrl();
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: sanitizedMessages,
            systemInstruction,
            modelName: currentModel,
            stream: true
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          let parsedError: any;
          try {
            parsedError = JSON.parse(errorText);
          } catch {
            parsedError = { message: errorText };
          }
          const errObj = new Error(
            parsedError.error?.message || parsedError.message || `HTTP error! status: ${response.status}`
          );
          (errObj as any).status = response.status;
          throw errObj;
        }

        if (!response.body) {
          throw new Error("Response body is not readable.");
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
              } catch (e) {
                console.error("Failed to parse stream chunk:", e, "Chunk string:", dataStr);
                continue;
              }

              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                hasYieldedAnyText = true;
                yield parsed.text;
              }
            }
          }
          return;
        } finally {
          reader.releaseLock();
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[chatWithGeminiStream] Attempt ${attempt} failed on model ${currentModel}:`, err);

        // If we already started streaming text to the user, notify and terminate cleanly
        if (hasYieldedAnyText) {
          yield "\n\n[Note: The stream connection was interrupted. Please retry to complete.]";
          return;
        }

        // Check context length error
        if (isContextLengthError(err) && sanitizedMessages.length > 4) {
          sanitizedMessages = sanitizeAndPruneMessages(sanitizedMessages, Math.floor(sanitizedMessages.length / 2));
          continue;
        }

        // If not transient and reached max attempts, break to next model
        if (!isTransientError(err) && attempt >= MAX_ATTEMPTS_PER_MODEL) {
          break;
        }

        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(retryDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    // Model exhausted - trigger fallback if another candidate exists and we haven't yielded partial text
    if (!hasYieldedAnyText && modelIdx < candidateModels.length - 1) {
      const nextModel = candidateModels[modelIdx + 1];
      console.warn(`[chatWithGeminiStream] Falling back from ${currentModel} to ${nextModel}`);
      onFallback?.(currentModel, nextModel);
    }
  }

  console.error("Gemini Streaming Error (via Proxy) after all recovery attempts:", lastError);
  yield "Error connecting to the stream.";
}
