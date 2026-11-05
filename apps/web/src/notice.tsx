import { useEffect, useState } from 'react';
import type { SyncStatus } from './api.ts';
import { backfillReason } from './sources.tsx';

type Backfill = NonNullable<SyncStatus['backfill']>;
const seenKey = 'trivimo-backfill-seen';
const readSeen = () => { try { return localStorage.getItem(seenKey); } catch { return null; } };
const writeSeen = (at: string) => { try { localStorage.setItem(seenKey, at); } catch { /* shown again after reload, no harm */ } };

/**
 * Global bar for the end of a history backfill (finished or stopped by an error). A run is announced once per browser:
 * closing the bar or opening #zrodla/pokrycie marks its finishedAt as seen; on that page itself the bar is not shown.
 */
export function BackfillNotice({ backfill, onCoverage, go }: { backfill: Backfill | undefined; onCoverage: boolean; go: (hash: string) => void }) {
  const [seen, setSeen] = useState(readSeen);
  const finished = backfill && (backfill.state === 'done' || backfill.state === 'error') && backfill.finishedAt ? backfill : null;
  const mark = (at: string) => { writeSeen(at); setSeen(at); };
  useEffect(() => { if (onCoverage && finished) mark(finished.finishedAt!); }, [onCoverage, finished?.finishedAt]);
  const visible = finished && !onCoverage && finished.finishedAt !== seen;
  const close = () => { if (finished) mark(finished.finishedAt!); };
  return visible && <div className={`notice ${finished.state === 'error' ? 'bad' : ''}`} role={finished.state === 'error' ? 'alert' : 'status'}>
      <button type="button" className="notice-body" onClick={() => { close(); go('zrodla/pokrycie'); }}>
        {finished.state === 'error'
          ? <>Uzupełnianie historii przerwane - {backfillReason(finished.code)}{finished.code ? ` (kod: ${finished.code})` : ''}. Spróbuj ponownie</>
          : <>Uzupełnianie historii od {finished.from} zakończone</>}
      </button>
      <button type="button" className="notice-close" aria-label="Zamknij powiadomienie" onClick={close}>×</button>
    </div>;
}
