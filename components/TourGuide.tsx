
import React from 'react';
import { LogoIcon } from './Icons';

interface TourGuideProps {
  onStartDemo: () => void;
  onSkip: () => void;
}

export const TourGuide: React.FC<TourGuideProps> = ({ onStartDemo, onSkip }) => {
  return (
    <div 
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fade-in" 
      aria-modal="true" 
      role="dialog"
    >
      <div 
        className="bg-white/30 dark:bg-slate-800/30 backdrop-blur-2xl border border-white/30 rounded-xl shadow-2xl w-full max-w-lg text-center p-8 text-white"
      >
        <LogoIcon className="h-16 w-16 mx-auto mb-4" />
        <h2 className="text-3xl font-bold text-gradient-animated mb-2">Welcome to AutoGradeX!</h2>
        <p className="text-slate-300 mb-6">
          Ready to see the future of grading? Let's start with a quick demo. We'll pre-load a sample question paper, answer key, and a student's answer sheet for you.
        </p>
        <p className="text-slate-300 mb-8">
          Just click "Grade Now" to see the AI in action!
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={onStartDemo}
            className="w-full bg-gradient-to-r from-blue-500 to-green-400 text-white font-bold py-3 px-4 rounded-lg hover:from-blue-600 hover:to-green-500 shadow-lg transition-all duration-300"
          >
            Start Demo
          </button>
          <button
            onClick={onSkip}
            className="w-full text-center py-3 px-4 rounded-md border border-white/30 text-sm font-semibold hover:bg-white/10"
          >
            Skip For Now
          </button>
        </div>
      </div>
    </div>
  );
};
