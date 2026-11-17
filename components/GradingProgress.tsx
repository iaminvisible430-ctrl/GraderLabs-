import React from 'react';
import { CheckIcon } from './Icons';

interface GradingProgressProps {
  steps: string[];
  isLoading: boolean;
  percentage: number;
}

export const GradingProgress: React.FC<GradingProgressProps> = ({
  steps,
  isLoading,
  percentage,
}) => {
  if (steps.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-mono shimmer-text font-semibold truncate">
              {steps[steps.length - 1] || 'Running Neural LLM Evaluation...'}
            </span>
            <span className="text-xs font-mono text-purple-200 font-bold tabular-nums shrink-0">
              {Math.round(percentage)}%
            </span>
          </div>

          <div className="w-full bg-[#130b29] border border-purple-500/25 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-600 via-fuchsia-500 to-indigo-400 h-full rounded-full shadow-[0_0_16px_rgba(168,85,247,0.75)] transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            <div className="h-14 rounded-xl skeleton-box" />
            <div className="h-14 rounded-xl skeleton-box" />
            <div className="h-14 rounded-xl skeleton-box hidden sm:block" />
            <div className="h-14 rounded-xl skeleton-box hidden sm:block" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {steps.map((step, index) => {
          const isLastStep = index === steps.length - 1;
          const isError = step.toLowerCase().startsWith('error:');

          return (
            <div key={index} className="flex items-start gap-2.5 animate-fade-in">
              <div
                className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                  isError
                    ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                    : isLoading && isLastStep
                    ? 'bg-purple-500 animate-pulse shadow-[0_0_12px_rgba(168,85,247,0.8)]'
                    : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                }`}
              >
                {!(isLoading && isLastStep) && !isError && (
                  <CheckIcon className="w-3 h-3 text-white" />
                )}
              </div>
              <p
                className={`text-xs leading-relaxed ${
                  isError
                    ? 'text-rose-300 font-semibold'
                    : isLoading && isLastStep
                    ? 'text-white font-semibold'
                    : 'text-purple-200/75'
                }`}
              >
                {step}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
