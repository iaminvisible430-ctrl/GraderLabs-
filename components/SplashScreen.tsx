import React from 'react';
import { LogoIcon } from './Icons';

export const SplashScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50 backdrop-blur-2xl">
      <div className="text-center p-8 bg-black/10 rounded-2xl shadow-2xl border border-white/20 animate-scale-in">
        <LogoIcon className="h-24 w-24 mx-auto animate-logo-pop" />
        <h1 className="text-5xl font-bold tracking-tight mt-6 animate-title-fade-in">
          <span className="text-gradient-animated">AutoGrade</span><span className="text-blue-400">X</span>
        </h1>
        <div className="mt-12 text-slate-300 text-center space-y-4">
            <div className="animate-fade-in-delay-1">
              <p className="text-sm uppercase tracking-widest">Contributors</p>
              <p className="text-lg font-semibold">
                <span className="text-sponsor-gradient">Mahmud Nil & Nabodoy Computer Science Technologies, LTD</span>
              </p>
            </div>
            <div className="animate-fade-in-delay-2 text-xs text-slate-400 flex flex-col sm:flex-row justify-center items-center gap-x-4 gap-y-1">
                <span>In partnership with <span className="font-semibold text-sponsor-gradient">Google Deepmind</span></span>
                <span className="hidden sm:inline text-slate-500">&bull;</span>
                <span>Made with <span className="font-semibold text-sponsor-gradient">Google AI Studio</span></span>
            </div>
        </div>
      </div>
    </div>
  );
};