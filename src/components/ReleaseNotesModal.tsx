import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, Sparkles, ChevronRight } from 'lucide-react';
import { RELEASE_NOTES } from './ReleaseNotesData';

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReleaseNotesModal({ isOpen, onClose }: ReleaseNotesModalProps) {
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
            data-testid="release-notes-backdrop"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-bg-secondary border border-border-primary p-6 shadow-2xl relative z-10 flex flex-col overflow-hidden transition-colors duration-300"
            data-testid="release-notes-modal"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border-primary shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-status-brand" />
                <h3 className="text-lg font-bold tracking-tight text-text-primary uppercase">
                  Release Notes
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
                aria-label="Close release notes modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Timeline */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-8 scrollbar-thin">
              <div className="relative border-l-2 border-border-primary ml-3 pl-6 space-y-8">
                {RELEASE_NOTES.map((note) => (
                  <div key={note.version} className="relative group">
                    {/* Timeline node */}
                    <div className={`absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 bg-bg-secondary transition-colors duration-300 ${
                      note.type === 'major'
                        ? 'border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]'
                        : 'border-border-secondary'
                    }`} />

                    {/* Content Box */}
                    <div className="bg-bg-primary/50 border border-border-primary/60 rounded-xl p-4 hover:border-orange-500/20 hover:bg-bg-primary/80 transition-all duration-300">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            note.type === 'major'
                              ? 'bg-orange-500/10 text-status-brand border border-orange-500/20'
                              : 'bg-bg-tertiary text-text-secondary border border-border-primary'
                          }`}>
                            {note.version}
                          </span>
                          <h4 className="text-sm font-bold text-text-primary">
                            {note.title}
                          </h4>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-wider">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{note.date}</span>
                        </div>
                      </div>

                      <p className="text-xs text-text-muted mb-3 leading-relaxed">
                        {note.description}
                      </p>

                      <div className="space-y-1.5">
                        {note.highlights.map((highlight, index) => (
                          <div key={index} className="flex items-start gap-2 text-xs text-text-secondary">
                            <ChevronRight className="w-3.5 h-3.5 text-status-brand shrink-0 mt-0.5" />
                            <span>{highlight}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer action */}
            <div className="mt-6 pt-4 border-t border-border-primary flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-bg-surface hover:bg-bg-tertiary border border-border-primary text-text-primary rounded-xl text-xs font-bold uppercase transition-all duration-200 cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
