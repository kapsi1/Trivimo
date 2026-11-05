import { useId } from 'react';

// Same geometry as docs/design/logo/trivimo-mark.svg (apple with the pulse cut out by a mask).
const apple = 'M0 -18C-15 -28 -27 -16 -27 0C-27 18 -15 30 0 28C15 30 27 18 27 0C27 -16 15 -28 0 -18Z';
const pulse = 'M-30 4L-13 4L-8 -7L-1 16L5 -2L9 4L30 4';
const stem = 'M0 -18C0 -26 3 -32 7 -35';
const leaf = 'M4 -26C8 -34 15 -36 19 -34C17 -26 10 -24 4 -26Z';

/** Trivimo mark. Decorative: the accessible name comes from the text next to it. */
export function LogoMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const id = `logo-cut${useId().replace(/[^\w-]/g, '')}`;
  return <svg className={className} viewBox="-36 -40 72 72" aria-hidden="true" focusable="false">
    <mask id={id} maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="80">
      <path d={apple} fill="#fff" />
      <path className={animated ? 'logo-trace' : undefined} d={pulse} pathLength={100} fill="none" stroke="#000" strokeWidth={3.5} strokeLinejoin="round" />
    </mask>
    <g className="logo-body">
      <path className="logo-apple" d={apple} mask={`url(#${id})`} />
      <path className="logo-stem" d={stem} fill="none" strokeWidth={3.5} strokeLinecap="round" />
      <path className="logo-leaf" d={leaf} />
    </g>
  </svg>;
}

/**
 * Loading indicator in place of the "Ładowanie…" text: the pulse is traced across the apple, which beats once per sweep.
 * `inline` fits a line of text, `page` is the full-screen start. Screen readers get the text through role="status".
 */
export function Loading({ size = 'block' }: { size?: 'block' | 'inline' | 'page' }) {
  return <span className={`loading ${size}`} role="status"><LogoMark animated /><span className="sr-only">Ładowanie…</span></span>;
}
