import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle, Cpu, RefreshCw, Network, HelpCircle } from 'lucide-react';
import { getOllamaConfig, setOllamaConfig, OllamaConfig } from '../services/gemini';
import { logAnalyticsEvent } from '../services/firebase';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange?: (config: OllamaConfig) => void;
}

export default function SettingsModal({ isOpen, onClose, onConfigChange }: SettingsModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('gemma4:e2b');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load configuration on mount or when modal opens
  useEffect(() => {
    if (isOpen) {
      const config = getOllamaConfig();
      setEnabled(config.enabled);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setStatusMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const newConfig: OllamaConfig = {
      enabled,
      baseUrl: baseUrl.trim(),
      model: model.trim()
    };
    setOllamaConfig(newConfig);
    logAnalyticsEvent('inference_settings_updated', {
      enabled: newConfig.enabled,
      model: newConfig.model
    });
    if (onConfigChange) {
      onConfigChange(newConfig);
    }
    onClose();
  };

  const testConnection = async () => {
    setIsTesting(true);
    setStatusMessage(null);
    try {
      // Direct call to Ollama tags/models API to see if it responds
      const response = await fetch(`${baseUrl.trim()}/api/tags`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      const modelsList = data.models || [];
      const hasModel = modelsList.some((m: any) => m.name === model.trim() || m.model === model.trim());

      if (hasModel) {
        setStatusMessage({
          type: 'success',
          text: `Successfully connected! Model "${model}" is loaded and ready.`
        });
      } else {
        const availableModels = modelsList.map((m: any) => m.name).join(', ') || 'none';
        setStatusMessage({
          type: 'info',
          text: `Connected to Ollama, but model "${model}" was not found. Available models: ${availableModels}`
        });
      }
    } catch (err: any) {
      console.error("Connection check failed:", err);
      setStatusMessage({
        type: 'error',
        text: `Failed to connect to Ollama at ${baseUrl}. Ensure Ollama is running and OLLAMA_ORIGINS="*" is set for network hosts.`
      });
    } finally {
      setIsTesting(false);
    }
  };

  const selectPreset = (presetType: 'laptop' | 'pc') => {
    if (presetType === 'laptop') {
      setBaseUrl('http://localhost:11434');
      setModel('gemma4:e2b');
    } else {
      // If it is currently localhost, suggest a generic Wi-Fi pattern but keep whatever IP they might have had
      if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        setBaseUrl('http://192.168.4.58:11434');
      }
      setModel('gemma4:26b');
    }
    setStatusMessage(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="w-full max-w-md rounded-2xl bg-bg-secondary border border-border-primary p-6 shadow-2xl relative z-10 overflow-hidden transition-colors duration-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4 border-b border-border-primary pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-status-brand" />
                <h3 className="text-lg font-bold tracking-tight text-text-primary uppercase">
                  Inference Settings
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
                aria-label="Close settings modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-text-muted text-xs leading-relaxed">
                Configure Cognitive Bridge to redirect chat requests directly to your local or wireless network Ollama endpoint.
              </p>

              {/* Status Banner */}
              {statusMessage && (
                <div
                  className={`p-3 border rounded-xl flex items-start gap-2.5 text-xs animate-shake ${
                    statusMessage.type === 'success'
                      ? 'bg-green-500/10 border-green-500/20 text-status-success'
                      : statusMessage.type === 'error'
                      ? 'bg-red-500/10 border-red-500/20 text-status-danger'
                      : 'bg-blue-500/10 border-blue-500/20 text-accent-blue'
                  }`}
                  role="alert"
                >
                  {statusMessage.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : statusMessage.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{statusMessage.text}</span>
                </div>
              )}

              {/* Mode Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-bg-primary border border-border-secondary">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-text-primary uppercase tracking-wide">Ollama Local Mode</span>
                  <span className="text-[10px] text-text-muted">Bypasses Cloud Vertex AI proxy</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-button-brand"></div>
                </label>
              </div>

              {/* Presets */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                  Quick Presets
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => selectPreset('laptop')}
                    className="py-2 px-3 border border-border-secondary bg-bg-primary hover:bg-bg-tertiary rounded-xl text-left text-xs transition-all flex flex-col justify-center cursor-pointer"
                  >
                    <span className="font-bold text-text-primary">MacBook Laptop</span>
                    <span className="text-[9px] text-text-muted truncate">gemma4:e2b @ localhost</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectPreset('pc')}
                    className="py-2 px-3 border border-border-secondary bg-bg-primary hover:bg-bg-tertiary rounded-xl text-left text-xs transition-all flex flex-col justify-center cursor-pointer"
                  >
                    <span className="font-bold text-text-primary">Windows PC Host</span>
                    <span className="text-[9px] text-text-muted truncate">gemma4:26b @ Wi-Fi</span>
                  </button>
                </div>
              </div>

              {/* Endpoint URL */}
              <div className="space-y-1.5">
                <label htmlFor="settings-url" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary flex items-center justify-between">
                  <span>Ollama Endpoint URL</span>
                  <span className="text-status-brand font-mono text-[9px]">Required</span>
                </label>
                <input
                  type="text"
                  id="settings-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  required
                  className="w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-mono"
                />
              </div>

              {/* Model Tag */}
              <div className="space-y-1.5">
                <label htmlFor="settings-model" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary flex items-center justify-between">
                  <span>Model Tag Name</span>
                  <span className="text-status-brand font-mono text-[9px]">Required</span>
                </label>
                <input
                  type="text"
                  id="settings-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gemma4:e2b"
                  required
                  className="w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-mono"
                />
              </div>

              {/* Connection note */}
              {baseUrl.indexOf('localhost') === -1 && baseUrl.indexOf('127.0.0.1') === -1 && (
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-2 text-[10px] text-status-warning leading-normal">
                  <Network className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    When connecting to a remote network device, ensure its Ollama server runs with environment variable <strong>OLLAMA_ORIGINS="*"</strong> set, or your browser will block the API call due to CORS restrictions.
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-border-primary mt-4">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={isTesting || !baseUrl.trim()}
                  className="px-4 py-2.5 border border-border-secondary bg-bg-surface hover:bg-bg-tertiary disabled:opacity-50 text-text-primary rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {isTesting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Checking...</span>
                    </>
                  ) : (
                    <span>Test Connection</span>
                  )}
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 text-xs font-bold uppercase text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-gradient-to-r from-button-brand to-red-800 text-white rounded-xl text-xs font-bold uppercase shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 active:scale-95 transition-all cursor-pointer"
                  >
                    Save & Close
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
