import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle, Loader2, Send } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, logAnalyticsEvent } from '../services/firebase';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'submitting' | 'success' | 'error';

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setMessage('');
      setStatus('idle');
      setErrorMsg('');
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

  const validateEmail = (emailStr: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !message.trim()) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    if (!validateEmail(email)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setStatus('submitting');

    try {
      await addDoc(collection(db, 'feedback'), {
        name: name.trim() || 'Anonymous',
        email: email.trim().toLowerCase(),
        message: message.trim(),
        createdAt: serverTimestamp(),
      });
      logAnalyticsEvent('feedback_submitted');
      setStatus('success');
      // Reset form
      setName('');
      setEmail('');
      setMessage('');
    } catch (err: any) {
      console.error('Error adding feedback to Firestore:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Failed to submit feedback. Please try again.');
    }
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
            data-testid="feedback-backdrop"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="w-full max-w-md rounded-2xl bg-bg-secondary border border-border-primary p-6 shadow-2xl relative z-10 overflow-hidden transition-colors duration-300"
            data-testid="feedback-modal"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold tracking-tight text-text-primary uppercase">
                Send Feedback
              </h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
                aria-label="Close feedback modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {status === 'success' ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-8 text-center"
                data-testid="success-view"
              >
                <div className="p-3 bg-green-500/10 text-status-success rounded-full mb-4">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h4 className="text-lg font-bold text-text-primary mb-2">Thank you!</h4>
                <p className="text-text-muted text-sm max-w-xs leading-relaxed">
                  Your feedback has been saved. I appreciate you taking the time to share your thoughts!
                </p>
                <button
                  onClick={onClose}
                  className="mt-6 px-6 py-2.5 bg-bg-surface hover:bg-bg-tertiary border border-border-primary text-text-primary rounded-xl text-xs font-bold uppercase transition-all duration-200 cursor-pointer"
                >
                  Close
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" data-testid="feedback-form">
                <p className="text-text-muted text-xs leading-relaxed">
                  Have questions, suggestions, or comments about Cognitive Bridge? Drop a message below!
                </p>

                {errorMsg && (
                  <div
                    className="p-3 bg-red-500/10 border border-red-500/20 text-status-danger rounded-xl flex items-start gap-2.5 text-xs animate-shake"
                    role="alert"
                    data-testid="error-banner"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Name */}
                <div className="space-y-1.5">
                  <label htmlFor="feedback-name" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Name (Optional)
                  </label>
                  <input
                    type="text"
                    id="feedback-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
                    disabled={status === 'submitting'}
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label htmlFor="feedback-email" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Email Address <span className="text-status-brand">*</span>
                  </label>
                  <input
                    type="email"
                    id="feedback-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    required
                    className="w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
                    disabled={status === 'submitting'}
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label htmlFor="feedback-message" className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Message <span className="text-status-brand">*</span>
                  </label>
                  <textarea
                    id="feedback-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell me what you think..."
                    required
                    rows={4}
                    className="w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all resize-none"
                    disabled={status === 'submitting'}
                  />
                </div>

                {/* Submit & Cancel */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 text-xs font-bold uppercase text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    disabled={status === 'submitting'}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-button-brand to-red-800 text-white rounded-xl text-xs font-bold uppercase shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:shadow-none transition-all cursor-pointer"
                    disabled={status === 'submitting'}
                  >
                    {status === 'submitting' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
