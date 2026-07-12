// /lab/case — Lab experiment: practise a real case with voice dictation.
//
// This is the ACTUAL practice app (the same HomeApp the homepage renders), with
// one difference: `dictation` puts a microphone beside Send. Reusing the real
// engine rather than a lookalike is the point — the examiner, the reveal
// discipline, the marksheet, history and autosave all behave exactly as they do
// in production, so what we learn here transfers without a rewrite. When
// dictation graduates, the flag flips on / and this page retires.
//
// Dictation itself is sign-in-gated (it spends a server-held STT key —
// invariant 9); everything else on the page works exactly as it does at /.

import type { Metadata } from 'next';
import HomeApp from '@/components/HomeApp';

export const metadata: Metadata = {
  title: 'Practise by voice — Lab',
  description: 'Practise a PACES case with voice dictation.',
  // Self-referencing — omitting this inherits the root layout's
  // `canonical: "/"`, pairing a noindex with a canonical pointing at the
  // homepage (see the note in app/lab/page.tsx).
  alternates: { canonical: '/lab/case' },
  robots: { index: false, follow: false },
};

export default function LabCasePage() {
  return <HomeApp dictation />;
}
