// The one list of suggested questions the app shows — reused by the home
// page (components/home/HomePanel.tsx), /ask's off-topic note, and
// /search's "no searchable terms" note (B11) so all three point at the same
// copy instead of inventing their own. Kept in its own module, with no
// JSX/CSS-module import, so web/scripts/check-suggestions.ts (B15) can
// import it directly under plain `tsx` — importing HomePanel.tsx itself
// pulls in home.module.css, which only Next's bundler can load.
//
// Family/lawyer framing (design/astra/home.html) verified against the live
// index (npm run suggestions:check, B15): each question is checked to
// actually route to a 'question' or 'search' plan with real results before
// it's kept here — see that script's header for the pass criteria.
export const SUGGESTED_QUESTION_GROUPS: [string, ...string[]][] = [
  [
    'For families',
    'Was asbestos found at 114 Liberty Street after September 11?',
    'Can these records connect an illness to a building?',
  ],
  [
    'For legal research',
    'Find sampling pages by address and Bates number.',
    'What do the records say about re-occupancy decisions?',
  ],
];

export const SUGGESTED_QUESTIONS = SUGGESTED_QUESTION_GROUPS.flatMap(([, ...questions]) => questions);
