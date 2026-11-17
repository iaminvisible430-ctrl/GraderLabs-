import React from 'react';
import { GradingMode } from '../types';
import { playSound } from '../utils/sound';

interface ReferenceLibraryProps {
  onClose: () => void;
  onTestNow: (testData: {
    questionPaperText: string;
    answerKeyText: string;
    studentSheetText: string;
    mode: GradingMode;
  }) => void;
}

const ENGLISH_LIT_QUESTION_PAPER = `English Literature Model Test (50 Marks)

Section A – Short Answer Questions (1 × 5 = 5 Marks)
1. Who is the author of Romeo and Juliet?
2. Define a metaphor.
3. What is the central theme of The Road Not Taken by Robert Frost?
4. Name one literary device used in Shakespeare’s Macbeth.
5. Who is the protagonist in Pride and Prejudice?

Section B – Fill in the Blanks (1 × 5 = 5 Marks)
6. A _______ is a comparison using “like” or “as.”
7. The play Hamlet was written by _______.
8. A character who opposes the protagonist is called the _______.
9. The poem Ozymandias was written by _______.
10. Hyperbole is an extreme _______ used for emphasis.

Section C – Short Paragraphs (2 × 5 = 10 Marks)
11. Describe the setting of To Kill a Mockingbird.
12. Explain the meaning of the phrase: “All the world’s a stage.”

Section D – Passage-based Questions (5 × 4 = 20 Marks)
"It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness..."
13. Identify the literary device used in the first line.
14. Who wrote this passage?
15. What does the line suggest about the society described?
16. Give one example of contrast from the passage.
17. Write a short sentence summarizing the main idea of this passage.

Section E – Essay Question (1 × 10 = 10 Marks)
18. Write an essay on the theme of “Courage and Morality in Literature” in 120–150 words.`;

const ENGLISH_LIT_ANSWER_KEY = `Answer Key (Correct Answers)

Section A:
1. William Shakespeare
2. A figure of speech comparing two unlike things without using “like” or “as”
3. Making choices and their consequences / personal decision-making
4. Foreshadowing / Metaphor / Dramatic Irony (any one)
5. Elizabeth Bennet

Section B:
6. Simile
7. William Shakespeare
8. Antagonist
9. Percy Bysshe Shelley
10. Exaggeration

Section C:
11. The setting is a small town in Alabama during the 1930s, depicting social and racial issues.
12. It means life is like a play, and humans are actors playing different roles at different stages.

Section D:
13. Antithesis / Parallelism
14. Charles Dickens
15. Society had extreme contrasts; good and bad coexisted
16. “Best of times, worst of times”
17. The passage shows contrasting conditions in society during that period.

Section E:
18. Essay should discuss examples of courage and moral choices in literature (120–150 words).`;

const ENGLISH_LIT_STUDENT_SHEET = `Sample Student Answer Sheet

Section A:
1. William Shakespear
2. Saying something is like another thing
3. Choices in life
4. Irony
5. Jane Bennet

Section B:
6. Simile
7. Shakespear
8. Villain
9. Percy Shelley
10. Overstatement

Section C:
11. A small town in the USA with social problems
12. Life is like a play

Section D:
13. Opposites
14. Dickens
15. Society had good and bad times
16. “Best and worst times”
17. Society had differences

Section E:
18. Essay mentions courage in Macbeth and moral choices in Pride and Prejudice.`;

export const ReferenceLibrary: React.FC<ReferenceLibraryProps> = ({ onClose, onTestNow }) => {
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in"
      aria-modal="true"
      role="dialog"
      onClick={() => {
        playSound('click');
        onClose();
      }}
    >
      <div
        className="liquid-glass border-glow border-glow-active w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden text-white rounded-3xl bg-[#080412]/95"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 sm:px-6 py-4 border-b border-purple-500/20 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-bold shimmer-text">GraderLabs Reference Library</h2>
            <p className="text-[11px] font-mono text-purple-300/65">
              PRE-VALIDATED RUBRIC &amp; OMR BENCHMARKS
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playSound('click');
              onClose();
            }}
            className="w-9 h-9 rounded-full bg-purple-950/70 border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white text-lg"
            aria-label="Close reference library"
          >
            &times;
          </button>
        </header>

        <main className="flex-grow overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6">
          <article className="liquid-glass border-glow p-4 sm:p-6 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-400/40 text-purple-200">
                  WRITTEN BENCHMARK • 50 MARKS
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white mt-2">
                  English Literature Model Test Package
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  playSound('upload');
                  onTestNow({
                    questionPaperText: ENGLISH_LIT_QUESTION_PAPER,
                    answerKeyText: ENGLISH_LIT_ANSWER_KEY,
                    studentSheetText: ENGLISH_LIT_STUDENT_SHEET,
                    mode: GradingMode.GEMINI_3_HANDWRITTEN,
                  });
                }}
                className="btn-quantix px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-white shrink-0 min-h-[42px]"
              >
                Mount &amp; Test in Studio &rarr;
              </button>
            </div>

            <div className="space-y-6 text-xs sm:text-sm text-purple-100/85">
              <div className="p-4 rounded-xl bg-[#0c061c] border border-purple-500/20">
                <h4 className="text-sm font-bold text-purple-200 border-b border-purple-500/20 pb-2 mb-3">
                  1. Model Question Paper
                </h4>
                <div className="space-y-3">
                  <div>
                    <p className="font-semibold text-white">Section A – Short Answer Questions (1 &times; 5 = 5 Marks)</p>
                    <ol className="list-decimal list-inside pl-3 space-y-1 mt-1 text-purple-200/80">
                      <li>Who is the author of <em>Romeo and Juliet</em>?</li>
                      <li>Define a metaphor.</li>
                      <li>What is the central theme of <em>The Road Not Taken</em> by Robert Frost?</li>
                      <li>Name one literary device used in Shakespeare&rsquo;s <em>Macbeth</em>.</li>
                      <li>Who is the protagonist in <em>Pride and Prejudice</em>?</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold text-white">Section B – Fill in the Blanks (1 &times; 5 = 5 Marks)</p>
                    <ol start={6} className="list-decimal list-inside pl-3 space-y-1 mt-1 text-purple-200/80">
                      <li>A _______ is a comparison using &ldquo;like&rdquo; or &ldquo;as.&rdquo;</li>
                      <li>The play <em>Hamlet</em> was written by _______.</li>
                      <li>A character who opposes the protagonist is called the _______.</li>
                      <li>The poem <em>Ozymandias</em> was written by _______.</li>
                      <li>Hyperbole is an extreme _______ used for emphasis.</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold text-white">Section C – Short Paragraphs (2 &times; 5 = 10 Marks)</p>
                    <ol start={11} className="list-decimal list-inside pl-3 space-y-1 mt-1 text-purple-200/80">
                      <li>Describe the setting of <em>To Kill a Mockingbird</em>.</li>
                      <li>Explain the meaning of the phrase: &ldquo;All the world&rsquo;s a stage.&rdquo;</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold text-white">Section D – Passage-based Questions (5 &times; 4 = 20 Marks)</p>
                    <p className="italic my-1.5 pl-3 text-purple-300/75">
                      &ldquo;It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness...&rdquo;
                    </p>
                    <ol start={13} className="list-decimal list-inside pl-3 space-y-1 mt-1 text-purple-200/80">
                      <li>Identify the literary device used in the first line.</li>
                      <li>Who wrote this passage?</li>
                      <li>What does the line suggest about the society described?</li>
                      <li>Give one example of contrast from the passage.</li>
                      <li>Write a short sentence summarizing the main idea of this passage.</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold text-white">Section E – Essay Question (1 &times; 10 = 10 Marks)</p>
                    <ol start={18} className="list-decimal list-inside pl-3 space-y-1 mt-1 text-purple-200/80">
                      <li>
                        Write an essay on the theme of <strong>&ldquo;Courage and Morality in Literature&rdquo;</strong> in 120–150 words.
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0c061c] border border-purple-500/20">
                <h4 className="text-sm font-bold text-purple-200 border-b border-purple-500/20 pb-2 mb-3">
                  2. Sample Student Answer Sheet Highlights
                </h4>
                <ul className="space-y-1.5 text-purple-200/80">
                  <li>1. William Shakespear &mdash; <span className="text-emerald-400 font-semibold">Correct</span></li>
                  <li>2. Saying something is like another thing &mdash; <span className="text-rose-400 font-semibold">Incorrect</span> (simile vs metaphor)</li>
                  <li>5. Jane Bennet &mdash; <span className="text-rose-400 font-semibold">Incorrect</span> (Elizabeth Bennet)</li>
                  <li>8. Villain &mdash; <span className="text-rose-400 font-semibold">Incorrect</span> (Antagonist)</li>
                  <li>13. Opposites &mdash; <span className="text-rose-400 font-semibold">Incorrect</span> (Antithesis)</li>
                </ul>
              </div>
            </div>
          </article>

          <article className="liquid-glass border-glow p-4 sm:p-6 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-400/40 text-purple-200">
                  OPTICAL BENCHMARK • 60 MARKS
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white mt-2">
                  OMR Mode Reference Specification
                </h3>
              </div>
              <span className="px-3 py-1.5 rounded-full text-[11px] font-mono bg-purple-950/70 border border-purple-500/30 text-purple-300/70">
                VISUAL SPECIMEN
              </span>
            </div>

            <p className="text-xs sm:text-sm text-purple-200/75 mb-4">
              Demonstrates how GraderLabs evaluates 12 optical matrix responses with partial credit and generates spatial pins for click-to-inspect review in Student Report Studio.
            </p>

            <div className="overflow-x-auto rounded-xl border border-purple-500/20">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-purple-950/60 text-purple-200 font-mono">
                  <tr>
                    <th className="p-2.5">Q#</th>
                    <th className="p-2.5">Student</th>
                    <th className="p-2.5">Key</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Marks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/15">
                  <tr className="bg-[#0c061c]">
                    <td className="p-2.5 font-mono">Q1</td><td className="p-2.5">5</td><td className="p-2.5">5</td>
                    <td className="p-2.5 text-emerald-400">Correct</td><td className="p-2.5 font-mono text-emerald-300">+5</td>
                  </tr>
                  <tr className="bg-rose-950/20">
                    <td className="p-2.5 font-mono">Q2</td><td className="p-2.5">12</td><td className="p-2.5">10</td>
                    <td className="p-2.5 text-rose-400">Wrong</td><td className="p-2.5 font-mono text-rose-300">+0</td>
                  </tr>
                  <tr className="bg-amber-950/20">
                    <td className="p-2.5 font-mono">Q4</td><td className="p-2.5">4</td><td className="p-2.5">5</td>
                    <td className="p-2.5 text-amber-400">Partial</td><td className="p-2.5 font-mono text-amber-300">+2</td>
                  </tr>
                  <tr className="bg-[#0c061c]">
                    <td className="p-2.5 font-mono">Q12</td><td className="p-2.5">6</td><td className="p-2.5">6</td>
                    <td className="p-2.5 text-emerald-400">Correct</td><td className="p-2.5 font-mono text-emerald-300">+5</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </main>
      </div>
    </div>
  );
};
