// The "this is under research" banner. One component so every Lab page makes
// the same promise (owner decision 2026-07-12: anyone may use the Lab, but
// they must know what they are walking into).

export default function LabBanner() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      🧪 <strong>Under research.</strong> Features here are experiments — not polished, not final,
      and they may change or disappear without notice. Feedback is very welcome (the Feedback form
      in the app reaches us).
    </div>
  );
}
