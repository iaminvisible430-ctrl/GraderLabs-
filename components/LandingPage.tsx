import React, { useState } from 'react';
import { LogoIcon } from './Icons';
import { playSound } from '../utils/sound';

interface LandingPageProps {
  onSignIn: (email: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onSignIn,
  soundEnabled,
  onToggleSound,
}) => {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [email, setEmail] = useState('evaluator@graderlabs.ai');
  const [accessKey, setAccessKey] = useState('••••••••••••');

  const openAuthModal = () => {
    playSound('click');
    setIsAuthOpen(true);
  };

  const closeAuthModal = () => {
    playSound('click');
    setIsAuthOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    playSound('portal');
    setIsAuthOpen(false);
    onSignIn(email.trim() || 'evaluator@graderlabs.ai');
  };

  return (
    <div className="relative min-h-screen overflow-hidden pb-20 bg-[#070510] text-[#f5f3ff]">
      {/* Background Grid & Top Spotlight */}
      <div className="cosmic-grid absolute inset-0 pointer-events-none" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[780px] h-[360px] bg-purple-600/25 blur-[130px] rounded-full pointer-events-none" />

      {/* Glowing Horizon Arch */}
      <div className="horizon-arch-wrapper">
        <div className="horizon-arch" />
      </div>

      {/* Header Navigation */}
      <header className="relative z-30 max-w-6xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 flex items-center justify-between gap-3">
        <a
          href="#hero"
          onClick={() => playSound('click')}
          className="flex items-center gap-2.5 group shrink-0"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-700 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.65)] border border-purple-300/40 group-hover:scale-105 transition">
            <LogoIcon className="w-5 h-5 text-white" />
          </div>
          <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
            GraderLabs
          </span>
        </a>

        {/* Center Glass Pill Nav */}
        <nav className="hidden md:flex items-center gap-1 p-1.5 rounded-full bg-[#160d2e]/75 backdrop-blur-xl border border-purple-400/25 shadow-[0_0_25px_rgba(124,58,237,0.2)]">
          <a
            href="#hero"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_14px_rgba(147,51,234,0.6)] whitespace-nowrap"
          >
            Home
          </a>
          <a
            href="#preview"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-4 py-1.5 rounded-full text-xs font-medium text-purple-200/80 hover:text-white transition whitespace-nowrap"
          >
            LLM Engine
          </a>
          <a
            href="#features"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-4 py-1.5 rounded-full text-xs font-medium text-purple-200/80 hover:text-white transition whitespace-nowrap"
          >
            Features
          </a>
          <a
            href="#features"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-4 py-1.5 rounded-full text-xs font-medium text-purple-200/80 hover:text-white transition whitespace-nowrap"
          >
            OMR + Written
          </a>
          <a
            href="#features"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-4 py-1.5 rounded-full text-xs font-medium text-purple-200/80 hover:text-white transition whitespace-nowrap"
          >
            Security
          </a>
        </nav>

        {/* Right Controls: Sound Toggle + Sign In CTA */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSound}
            title="Toggle UI Feedback Sounds"
            className="w-10 h-10 rounded-full liquid-glass border-glow flex items-center justify-center text-purple-300 hover:text-white"
            aria-label="Toggle UI sound effects"
          >
            {soundEnabled ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                />
              </svg>
            )}
          </button>

          <button
            type="button"
            onMouseEnter={() => playSound('hover')}
            onClick={openAuthModal}
            className="btn-quantix px-5 py-2.5 rounded-full text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap min-h-[40px]"
          >
            <span>Sign In</span>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </header>

      {/* HERO SECTION */}
      <section id="hero" className="relative z-20 max-w-4xl mx-auto px-5 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-16 text-center animate-surface-enter">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-950/60 border border-purple-400/35 backdrop-blur-md shadow-[0_0_20px_rgba(168,85,247,0.35)] mb-6 max-w-full">
          <svg
            className="w-3.5 h-3.5 text-purple-300 animate-spin shrink-0"
            style={{ animationDuration: '7s' }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"
            />
          </svg>
          <span className="text-[11px] font-medium tracking-wide text-purple-200 text-left sm:text-center">
            Optimize Exam Workflows with Multi-Modal LLMs
          </span>
        </div>

        <h1 className="text-[clamp(2.1rem,6vw,3.75rem)] font-bold tracking-tight leading-[1.13] glow-text text-white max-w-3xl mx-auto">
          Elevate Exam Evaluation Using <span className="shimmer-text">AI-Driven Precision</span>
        </h1>

        <p className="mt-5 text-sm sm:text-base text-purple-200/70 max-w-xl mx-auto leading-relaxed font-normal">
          An intelligent assessment platform powered by vision-language LLMs that evaluates OMR sheets,
          handwritten scripts, and complex rubrics in seconds.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
          <button
            type="button"
            onMouseEnter={() => playSound('hover')}
            onClick={openAuthModal}
            className="btn-quantix px-6 py-3.5 rounded-full text-xs sm:text-sm font-semibold text-white flex items-center justify-center gap-2.5 min-h-[46px]"
          >
            <span>Enter Grader Studio</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>

          <a
            href="#features"
            onMouseEnter={() => playSound('hover')}
            onClick={() => playSound('click')}
            className="px-6 py-3.5 rounded-full text-xs sm:text-sm font-semibold text-purple-100 liquid-glass border-glow hover:bg-purple-900/30 flex items-center justify-center gap-2.5 min-h-[46px]"
          >
            <span>Explore Architecture</span>
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
      </section>

      {/* HERO MOCKUP PREVIEW */}
      <section id="preview" className="relative z-20 max-w-5xl mx-auto px-4 sm:px-6 mt-2 animate-surface-enter">
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-3/4 h-28 bg-purple-500/25 blur-3xl pointer-events-none" />

        <div className="liquid-glass border-glow rounded-[26px] p-4 sm:p-7 bg-[#090514]/90 shadow-[0_30px_100px_rgba(0,0,0,0.95)] relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-purple-500/15">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center shadow-[0_0_12px_#9333ea]">
                  <LogoIcon className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-bold text-white">GraderLabs</span>
              </div>

              <div className="hidden sm:flex items-center gap-2 bg-[#130b29] border border-purple-500/20 rounded-full px-4 py-1.5 w-64">
                <svg className="w-3.5 h-3.5 text-purple-300/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="text-xs text-purple-300/50">Search rubric, batch or student ID...</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-purple-100">Dean&apos;s Portal</span>
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 p-[1.5px]">
                <div className="w-full h-full rounded-full bg-cosmic-900 flex items-center justify-center text-[10px] font-bold">
                  GL
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6 items-stretch">
            <div className="lg:col-span-7 flex gap-4">
              <div className="hidden sm:flex flex-col items-center gap-3 pt-8">
                <div className="w-9 h-9 rounded-full bg-white text-cosmic-950 flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.8)]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <div className="w-9 h-9 rounded-full bg-[#140b29] border border-purple-500/20 text-purple-300/70 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="w-9 h-9 rounded-full bg-[#140b29] border border-purple-500/20 text-purple-300/70 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg sm:text-xl font-bold text-white mb-3">Evaluation Velocity</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-purple-600 text-white shadow-[0_0_12px_#9333ea]">
                    All Modes
                  </span>
                  <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[#140b2b] text-purple-300/70 border border-purple-500/20">
                    OMR Bubbles
                  </span>
                  <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[#140b2b] text-purple-300/70 border border-purple-500/20">
                    Handwritten
                  </span>
                  <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[#140b2b] text-purple-300/70 border border-purple-500/20">
                    Auto-Hybrid
                  </span>
                </div>

                <div className="liquid-glass border-glow rounded-2xl p-4 sm:p-5 bg-[#100821]/90">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-xs font-semibold text-purple-100">LLM Grading Throughput</span>
                    <span className="text-[11px] text-purple-300/70">Vision Pipeline &rarr;</span>
                  </div>

                  <div className="flex items-end gap-3 h-36 pt-6 px-1 sm:px-2">
                    <div className="flex flex-col justify-between h-full text-[10px] text-purple-300/40 pr-2 font-mono tabular-nums">
                      <span>99%</span>
                      <span>85%</span>
                      <span>70%</span>
                      <span>50%</span>
                    </div>
                    <div className="flex-1 grid grid-cols-7 gap-2 items-end h-full">
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[45%]" />
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[68%]" />
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[52%]" />
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[62%]" />
                      <div className="relative bg-gradient-to-t from-purple-700 via-purple-500 to-purple-300 rounded-t-xl h-[92%] shadow-[0_0_25px_rgba(168,85,247,0.8)] flex flex-col items-center">
                        <div className="-top-7 absolute px-2 py-0.5 rounded-full bg-[#1e113a] border border-purple-400/50 text-[9px] font-mono text-purple-100 whitespace-nowrap shadow-lg tabular-nums">
                          99.8% Acc
                        </div>
                        <div className="w-2.5 h-2.5 rounded-full bg-cosmic-950 border-2 border-white mt-1.5" />
                      </div>
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[60%]" />
                      <div className="bg-purple-900/35 border border-purple-500/20 rounded-t-xl h-[74%]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between gap-4">
              <div className="liquid-glass border-glow specular-beam rounded-2xl p-5 bg-[#120926]/90 flex-1 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-200">Neural Grading Engine</span>
                  <span className="text-[11px] text-purple-300/70">Vision Core &rarr;</span>
                </div>

                <div className="my-3 p-5 rounded-2xl bg-gradient-to-br from-[#23124c] via-[#13092b] to-[#3b1578] border border-purple-400/35 shadow-[0_10px_35px_rgba(124,58,237,0.35)] relative overflow-hidden">
                  <div className="absolute -bottom-6 -right-4 w-32 h-32 bg-purple-400/30 blur-2xl rounded-full" />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-purple-300/70">Rubric Confidence</p>
                      <p className="text-2xl font-bold text-white mt-0.5 font-mono tabular-nums">99.94% LLM</p>
                    </div>
                    <svg className="w-6 h-6 text-purple-300/80" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                    </svg>
                  </div>
                  <div className="mt-5 flex items-center justify-between text-[10px] font-mono text-purple-200/70">
                    <span>OMR + HANDWRITING PARSER</span>
                    <span>ZERO-OMISSION</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-white">Studio Pipeline</span>
                    <button
                      type="button"
                      onClick={openAuthModal}
                      className="text-[11px] text-purple-300 hover:text-white"
                    >
                      Open Studio &rarr;
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-cosmic-950/60 border border-purple-500/15">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-400/40 flex items-center justify-center text-purple-300 text-xs font-bold">
                        AI
                      </div>
                      <div>
                        <p className="text-xs font-medium text-white">Auto-Detect Mode Ready</p>
                        <p className="text-[10px] text-purple-300/50">Awaiting Question Paper &amp; Key</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-semibold text-emerald-400">READY</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#040209] to-transparent pointer-events-none absolute" />
        </div>
      </section>

      {/* TRUSTED BY LOGOS STRIP */}
      <section className="max-w-5xl mx-auto px-6 pt-14 sm:pt-16 pb-8 text-center">
        <p className="text-xs font-medium text-purple-200/60 tracking-wide mb-7">
          Trusted by 10,000+ Academic Institutions &amp; EdTech Teams Worldwide
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 items-center opacity-70">
          <div className="flex items-center justify-center gap-2 text-sm font-bold tracking-tight text-purple-100/80">
            <span className="w-4 h-4 rounded-full border-2 border-purple-400 inline-block" /> OXFORD LAB
          </div>
          <div className="flex items-center justify-center gap-2 text-sm font-bold tracking-tight text-purple-100/80">
            <svg className="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2L2 7l8 5 8-5-8-5zM2 13l8 5 8-5" />
            </svg>{' '}
            STANFORD AI
          </div>
          <div className="flex items-center justify-center gap-1.5 text-sm font-extrabold tracking-widest text-purple-100/80">
            EDUMETRIC
          </div>
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-purple-100/80">
            <span>neuro</span>
            <span className="px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200 text-xs">grade</span>
          </div>
          <div className="flex items-center justify-center gap-1 text-sm font-black tracking-wider text-purple-100/80">
            APEX<span className="text-purple-400">OMR</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-purple-100/80">
            <span className="w-3.5 h-3.5 rotate-45 bg-purple-400/70 inline-block" /> CORTEX EDU
          </div>
        </div>
      </section>

      {/* BENTO FEATURES SECTION */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-14">
        <div className="text-center max-w-xl mx-auto mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-3 mb-3">
            <span className="w-12 h-[1px] bg-gradient-to-r from-transparent to-purple-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-purple-300">Features</span>
            <span className="w-12 h-[1px] bg-gradient-to-l from-transparent to-purple-400" />
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight leading-tight glow-text">
            Accelerate exam grading using streamlined LLM pipelines.
          </h2>
          <p className="mt-3 text-xs sm:text-sm text-purple-200/60 leading-relaxed">
            All the neural tools you need to parse Question Papers, align Answer Keys, and grade OMR or handwritten Student Sheets with zero manual bias.
          </p>
        </div>

        {/* Row 1: 3 Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div
            onMouseEnter={() => playSound('hover')}
            className="liquid-glass border-glow specular-beam hover-lift p-6 flex flex-col justify-between min-h-[290px]"
          >
            <div className="h-44 flex items-center justify-center relative">
              <svg className="w-full h-full opacity-75" viewBox="0 0 260 160" fill="none">
                <path d="M20 80 H75 L95 60 H165 L185 80 H240" stroke="url(#gradLine1)" strokeWidth="1.5" />
                <path d="M60 30 V55 L85 80 L60 105 V130" stroke="url(#gradLine1)" strokeWidth="1.5" />
                <path d="M200 30 V55 L175 80 L200 105 V130" stroke="url(#gradLine1)" strokeWidth="1.5" />
                <circle cx="40" cy="80" r="3" fill="#c084fc" />
                <circle cx="220" cy="80" r="3" fill="#c084fc" />
                <circle cx="60" cy="30" r="2.5" fill="#a855f7" />
                <circle cx="200" cy="130" r="2.5" fill="#a855f7" />
                <defs>
                  <linearGradient id="gradLine1" x1="0" y1="0" x2="260" y2="160" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#581c87" stopOpacity="0.1" />
                    <stop offset="0.5" stopColor="#c084fc" stopOpacity="0.9" />
                    <stop offset="1" stopColor="#581c87" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute w-16 h-16 rounded-full bg-[#1a0d36] border border-purple-400/50 flex items-center justify-center orb-glow">
                <LogoIcon className="w-7 h-7 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">GraderLabs LLM Core</h3>
              <p className="text-xs text-purple-200/60 mt-1.5 leading-relaxed">
                Multi-modal reasoning engine that cross-references your Question Paper and Answer Key for semantic grading.
              </p>
            </div>
          </div>

          <div
            onMouseEnter={() => playSound('hover')}
            className="liquid-glass border-glow specular-beam hover-lift p-6 flex flex-col justify-between min-h-[290px]"
          >
            <div className="h-44 flex items-center justify-center relative">
              <div className="w-36 h-36 rounded-full border border-purple-500/20 flex items-center justify-center relative">
                <div className="w-24 h-24 rounded-full border border-purple-400/30 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-b from-purple-400 to-purple-700 flex items-center justify-center orb-glow">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-purple-950 border border-purple-400/50 text-[9px] font-mono text-purple-200 shadow-md">
                  A+ 98%
                </div>
                <div className="absolute bottom-2 -left-2 px-2 py-0.5 rounded-full bg-purple-950 border border-purple-400/50 text-[9px] font-mono text-purple-200 shadow-md">
                  OCR
                </div>
                <div className="absolute bottom-3 -right-3 px-2 py-0.5 rounded-full bg-purple-950 border border-purple-400/50 text-[9px] font-mono text-purple-200 shadow-md">
                  Rubric
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Written Script Evaluation</h3>
              <p className="text-xs text-purple-200/60 mt-1.5 leading-relaxed">
                Evaluates complex handwritten paragraphs, formulas, and diagrams with partial-credit rubric breakdown.
              </p>
            </div>
          </div>

          <div
            onMouseEnter={() => playSound('hover')}
            className="liquid-glass border-glow specular-beam hover-lift p-6 flex flex-col justify-between min-h-[290px]"
          >
            <div className="h-44 flex items-center justify-center relative overflow-hidden">
              <svg className="w-full h-36" viewBox="0 0 280 120" fill="none">
                <path d="M0 95 Q35 90 55 72 T110 80 T155 32 T210 55 T280 25 L280 120 L0 120 Z" fill="url(#areaGrad)" />
                <path d="M0 95 Q35 90 55 72 T110 80 T155 32 T210 55 T280 25" stroke="#c084fc" strokeWidth="2" />
                <line x1="155" y1="10" x2="155" y2="115" stroke="#e9d5ff" strokeDasharray="3 3" strokeWidth="1" />
                <circle cx="155" cy="32" r="4.5" fill="#ffffff" stroke="#9333ea" strokeWidth="2.5" />
                <defs>
                  <linearGradient id="areaGrad" x1="140" y1="20" x2="140" y2="120" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#9333ea" stopOpacity="0.48" />
                    <stop offset="1" stopColor="#090514" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Answer Key Synchronization</h3>
              <p className="text-xs text-purple-200/60 mt-1.5 leading-relaxed">
                Ingest structured or unstructured Answer Keys and let the LLM normalize point distributions automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Row 2: 2 Wide Cards */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div
            onMouseEnter={() => playSound('hover')}
            className="md:col-span-6 liquid-glass border-glow specular-beam hover-lift p-7 flex flex-col justify-between min-h-[280px]"
          >
            <div className="h-40 flex items-center justify-center relative">
              <div className="flex items-center gap-1.5 w-full justify-center">
                <span className="w-1 h-4 bg-purple-500/30 rounded-full" />
                <span className="w-1 h-8 bg-purple-500/40 rounded-full" />
                <span className="w-1 h-12 bg-purple-400/60 rounded-full" />
                <span className="w-1 h-6 bg-purple-500/40 rounded-full" />
                <span className="w-1 h-10 bg-purple-400/70 rounded-full" />
                <span className="w-1 h-16 bg-purple-300 rounded-full" />
                <span className="w-1 h-9 bg-purple-400/60 rounded-full" />

                <div className="mx-4 w-16 h-16 rounded-full bg-gradient-to-b from-purple-400 to-purple-700 flex items-center justify-center orb-glow relative">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>

                <span className="w-1 h-9 bg-purple-400/60 rounded-full" />
                <span className="w-1 h-16 bg-purple-300 rounded-full" />
                <span className="w-1 h-10 bg-purple-400/70 rounded-full" />
                <span className="w-1 h-6 bg-purple-500/40 rounded-full" />
                <span className="w-1 h-12 bg-purple-400/60 rounded-full" />
                <span className="w-1 h-8 bg-purple-500/40 rounded-full" />
                <span className="w-1 h-4 bg-purple-500/30 rounded-full" />
              </div>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">OMR + Written Auto-Detection</h3>
              <p className="text-xs text-purple-200/60 mt-1.5 leading-relaxed">
                Hybrid vision pipeline automatically distinguishes optical multiple-choice bubbles from handwritten subjective responses on the same sheet.
              </p>
            </div>
          </div>

          <div
            onMouseEnter={() => playSound('hover')}
            className="md:col-span-6 liquid-glass border-glow specular-beam hover-lift p-7 flex flex-col justify-between min-h-[280px]"
          >
            <div className="h-40 flex items-end justify-center gap-3 sm:gap-4 pt-6 px-2 sm:px-4">
              <div className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full h-20 rounded-xl bg-purple-900/35 border border-purple-500/20" />
                <span className="text-[10px] text-purple-300/50 font-mono">Q1</span>
              </div>
              <div className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full h-14 rounded-xl bg-purple-900/35 border border-purple-500/20" />
                <span className="text-[10px] text-purple-300/50 font-mono">Q2</span>
              </div>
              <div className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full h-24 rounded-xl bg-purple-900/35 border border-purple-500/20" />
                <span className="text-[10px] text-purple-300/50 font-mono">Q3</span>
              </div>
              <div className="flex flex-col items-center gap-2 flex-1 relative">
                <div className="-top-7 absolute px-2 py-0.5 rounded-full bg-[#1f113d] border border-purple-400/50 text-[9px] font-mono text-purple-100 whitespace-nowrap">
                  +10.0 PTS
                </div>
                <div className="w-full h-28 rounded-xl bg-gradient-to-t from-purple-700 via-purple-500 to-purple-300 shadow-[0_0_25px_rgba(168,85,247,0.85)] flex justify-center pt-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cosmic-950 border-2 border-white" />
                </div>
                <span className="text-[10px] text-white font-semibold font-mono">Q4</span>
              </div>
              <div className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full h-16 rounded-xl bg-purple-900/35 border border-purple-500/20" />
                <span className="text-[10px] text-purple-300/50 font-mono">Q5</span>
              </div>
              <div className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full h-20 rounded-xl bg-purple-900/35 border border-purple-500/20" />
                <span className="text-[10px] text-purple-300/50 font-mono">Q6</span>
              </div>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Per-Question Telemetry &amp; Audit</h3>
              <p className="text-xs text-purple-200/60 mt-1.5 leading-relaxed">
                Effortlessly inspect question-by-question LLM justification, student handwriting confidence, and rubric point deductions in the Student Report Studio.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center">
          <button
            type="button"
            onMouseEnter={() => playSound('hover')}
            onClick={openAuthModal}
            className="btn-quantix px-7 py-3.5 rounded-full text-xs sm:text-sm font-semibold text-white inline-flex items-center gap-2 min-h-[46px]"
          >
            <span>Launch GraderLabs Studio</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </section>

      {/* AUTH SIGN-IN MODAL */}
      {isAuthOpen && (
        <div
          onClick={closeAuthModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="liquid-glass border-glow border-glow-active specular-beam max-w-md w-full p-6 sm:p-7 rounded-3xl relative animate-surface-enter my-auto"
          >
            <button
              type="button"
              onClick={closeAuthModal}
              className="absolute top-5 right-5 w-9 h-9 rounded-full bg-purple-950/70 border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white text-lg"
              aria-label="Close sign in dialog"
            >
              &times;
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-700 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.75)]">
                <LogoIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white leading-none">Sign In to GraderLabs</h3>
                <p className="text-[11px] text-purple-300/70 mt-1">LLM Assessment &amp; Evaluation Workspace</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-purple-200 mb-1.5">
                  Evaluator / Institution Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#090414]/90 border border-purple-500/35 text-sm text-white focus:outline-none focus:border-purple-400 shadow-inner"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-purple-200 mb-1.5">
                  Workspace Access Key
                </label>
                <input
                  type="password"
                  required
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#090414]/90 border border-purple-500/35 text-sm text-white focus:outline-none focus:border-purple-400 shadow-inner"
                />
              </div>

              <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-500/25 flex items-center justify-between text-[11px] text-purple-200/80">
                <span>Clean Workspace Mode:</span>
                <span className="font-mono text-emerald-400 font-semibold">0 Demo Data (Fresh State)</span>
              </div>

              <button
                type="submit"
                className="w-full btn-quantix py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 mt-2 min-h-[46px]"
              >
                <span>Authenticate &amp; Initialize Workspace</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
