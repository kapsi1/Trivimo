import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { groups, metricOf, type MetricKey } from './api.ts';
import { CloseIcon, useDialog } from './details.tsx';
import { colsFor, defaultLayout, dropOn, GAP, isStat, moveTile, pack, packedRows, parseLayout, placeOf, removeTile, resizeTile, ROW_H, serializeLayout, setPlace, sizeIn, tileAt, toTable, tileSpecs, type DayLayout, type Place, type Placed, type StatId, type Tile, type TileId } from './day-layout.ts';
import { Segmented } from './zoom.tsx';
import { summaryRowOf } from './summaries.tsx';
import type { SummaryType } from './summary-number.ts';

const storeKey = 'trivimo-day-tiles';
/** Per-browser for now; the database-backed view preferences (plan 04) will take it over. */
export function loadLayout(): DayLayout { try { return parseLayout(JSON.parse(localStorage.getItem(storeKey) ?? 'null')); } catch { return defaultLayout(); } }
export function saveLayout(layout: DayLayout) { try { localStorage.setItem(storeKey, JSON.stringify(serializeLayout(layout))); } catch { /* per-browser convenience only */ } }

export function tileLabel(id: TileId): string {
  if (id === 'hr') return 'Tętno';
  if (id === 'note') return 'Moja notatka';
  if (id === 'summaries') return 'Tabela „Wskaźniki dobowe”';
  if (id.startsWith('metric:')) return metricOf(id.slice(7) as MetricKey).label;
  return summaryRowOf(id.slice(8) as SummaryType).label;
}
const catalogGroups: [string, string, TileId[]][] = [
  ['Ciało', groups.body.color, ['metric:weight', 'metric:body_fat']],
  ['Energia', groups.energy.color, ['metric:total_energy', 'metric:active_energy']],
  ['Aktywność', groups.activity.color, ['metric:steps', 'metric:distance']],
  ['Wskaźniki dobowe', groups.body.color, tileSpecs.filter((item) => item.id.startsWith('summary:')).map((item) => item.id)],
  ['Inne', 'var(--c-band)', ['hr', 'note', 'summaries']],
];

type Under = TileId | 'end' | null;
type Gesture =
  | { kind: 'drag'; id: TileId; pointerId: number; x0: number; y0: number; x: number; y: number; slot0: { x: number; y: number }; under: Under; active: boolean }
  | { kind: 'resize'; id: TileId; pointerId: number; x0: number; y0: number; x: number; y: number; w0: number; h0: number };

/**
 * The day's tiles on a grid of 12 / 8 / 4 columns (by width) and rows of ROW_H. In edit mode a tile is dragged by
 * its body (mouse) or grip (touch) and resized by its corner in whole grid steps; the other tiles reflow with a short animation.
 */
export function TileBoard({ layout, onLayout, editing, onDone, render }: { layout: DayLayout; onLayout: (layout: DayLayout) => void; editing: boolean; onDone: () => void; render: (tile: Placed) => ReactNode }) {
  const board = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Tile[] | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [catalog, setCatalog] = useState(false);
  const start = useRef<DayLayout | null>(null);
  if (editing && !start.current) start.current = layout;
  if (!editing && start.current) start.current = null;

  useLayoutEffect(() => {
    const element = board.current; if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const cols = colsFor(width || 1200), colW = width ? (width - GAP * (cols - 1)) / cols : 0;
  const stepX = colW + GAP, stepY = ROW_H + GAP;
  const tiles = draft ?? layout.tiles, placed = pack(tiles, cols), rows = packedRows(placed);

  // reflow animation: a tile that changed place slides from where it was (offsets ignore transforms)
  const elements = useRef(new Map<TileId, HTMLDivElement>());
  const seen = useRef(new Map<TileId, { x: number; y: number }>());
  const dragShift = gesture?.kind === 'drag' && gesture.active ? shiftOf(gesture) : null;
  function shiftOf(g: Extract<Gesture, { kind: 'drag' }>) {
    const slot = placed.find((item) => item.id === g.id);
    return slot ? { x: g.x - g.x0 - (slot.x - g.slot0.x) * stepX, y: g.y - g.y0 - (slot.y - g.slot0.y) * stepY } : { x: 0, y: 0 };
  }
  useLayoutEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, element] of elements.current) {
      const now = { x: element.offsetLeft, y: element.offsetTop }, before = seen.current.get(id);
      if (dragShift && gesture?.id === id) { seen.current.set(id, { x: now.x + dragShift.x, y: now.y + dragShift.y }); continue; }
      seen.current.set(id, now);
      if (!editing || still || !before || (before.x === now.x && before.y === now.y)) continue;
      element.style.transition = 'none';
      element.style.transform = `translate(${before.x - now.x}px, ${before.y - now.y}px)`;
      void element.offsetWidth;
      element.style.transition = 'transform 180ms ease';
      element.style.transform = '';
    }
  });

  // Esc cancels a gesture in progress
  useEffect(() => {
    if (!gesture) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setGesture(null); setDraft(null); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [!!gesture]);

  const cellAt = (x: number, y: number) => {
    const rect = board.current!.getBoundingClientRect();
    return { cx: Math.min(cols - 1, Math.max(0, Math.floor((x - rect.left) / stepX))), cy: Math.floor((y - rect.top) / stepY) };
  };
  const underAt = (list: Tile[], x: number, y: number): Under => {
    const { cx, cy } = cellAt(x, y), spots = pack(list, cols);
    if (cy < 0) return null;
    return cy >= packedRows(spots) ? 'end' : tileAt(spots, cx, cy)?.id ?? null;
  };

  function down(event: ReactPointerEvent<HTMLDivElement>, tile: Placed, kind: 'drag' | 'resize') {
    if (!editing || event.button !== 0) return;
    const grip = (event.target as Element).closest('[data-grip]');
    if (kind === 'drag' && (event.target as Element).closest('button:not([data-grip])')) return;
    if (kind === 'drag' && event.pointerType !== 'mouse' && !grip) return; // touch scrolls the page unless it starts on the grip
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = { id: tile.id, pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY };
    setGesture(kind === 'drag' ? { ...base, kind, slot0: { x: tile.x, y: tile.y }, under: tile.id, active: false } : { ...base, kind, w0: tile.w * stepX - GAP, h0: tile.h * stepY - GAP });
    if (kind === 'resize') setDraft(layout.tiles);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return;
    const x = event.clientX, y = event.clientY;
    if (g.kind === 'resize') {
      const current = tiles.find((tile) => tile.id === g.id)!;
      const w = Math.min(cols, Math.round((g.w0 + x - g.x0 + GAP) / stepX)), h = Math.round((g.h0 + y - g.y0 + GAP) / stepY);
      const next = resizeTile(tiles, g.id, { w: Math.max(1, w), h: Math.max(1, h) });
      if (next.find((tile) => tile.id === g.id)!.w !== current.w || next.find((tile) => tile.id === g.id)!.h !== current.h) setDraft(next);
      setGesture({ ...g, x, y });
      return;
    }
    if (!g.active && Math.hypot(x - g.x0, y - g.y0) < 5) return;
    const list = draft ?? layout.tiles;
    if (!g.active) setDraft(list);
    const under = underAt(list, x, y);
    if (under === g.under) { setGesture({ ...g, x, y, active: true }); return; }
    let next = list;
    if (under === 'end') { const from = list.findIndex((tile) => tile.id === g.id); if (from !== list.length - 1) next = moveTile(list, from, list.length - 1); }
    else if (under && under !== g.id) next = dropOn(list, g.id, under, cols);
    if (next !== list) setDraft(next);
    // hysteresis: the tile now under the pointer must be left before it can be a target again
    setGesture({ ...g, x, y, active: true, under: next === list ? under : underAt(next, x, y) });
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return;
    if (draft && (g.kind === 'resize' || g.active)) onLayout({ ...layout, tiles: draft });
    setGesture(null); setDraft(null);
  }
  function key(event: ReactKeyboardEvent<HTMLDivElement>, tile: Placed) {
    if (!editing || event.target !== event.currentTarget) return;
    const index = layout.tiles.findIndex((item) => item.id === tile.id), stored = layout.tiles[index];
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === 'Delete' || event.key === 'Backspace') onLayout(removeTile(layout, tile.id));
    else if (step[event.key] && event.shiftKey) { const [dw, dh] = step[event.key]; onLayout({ ...layout, tiles: resizeTile(layout.tiles, tile.id, { w: Math.min(cols, sizeIn(stored, cols).w + dw), h: stored.h + dh }) }); }
    else if (step[event.key]) { const [dx, dy] = step[event.key]; onLayout({ ...layout, tiles: moveTile(layout.tiles, index, index + dx + dy) }); }
    else return;
    event.preventDefault();
  }

  // a cut tile title gets the full name as a tooltip (kept together with an explanatory hint, e.g. HRV)
  function fullTitle(event: ReactPointerEvent) {
    const head = (event.target as Element).closest?.('.tile h3.th') as HTMLElement | null;
    if (!head) return;
    head.dataset.hint ??= head.title;
    const cut = head.scrollWidth > head.clientWidth;
    head.title = cut ? [head.textContent, head.dataset.hint].filter(Boolean).join(' — ') : head.dataset.hint;
  }

  const extraRows = editing ? 1 : 0, total = rows + extraRows;
  const g = gesture;
  return <section className={`board${editing ? ' editing' : ''}`} aria-label="Kafelki dnia">
    {editing && <div className="boardbar" role="toolbar" aria-label="Edycja układu">
      <span className="boardhint">Przeciągnij kafelek, by go przenieść — na kafelek tego samego rozmiaru zamienia się z nim miejscami. Róg zmienia rozmiar o całe pola siatki.</span>
      <button type="button" className="btn" onClick={() => setCatalog(true)}>+ Kafelki</button>
      <button type="button" className="btn ghost" onClick={() => onLayout(defaultLayout())}>Przywróć domyślny</button>
      <button type="button" className="btn ghost" onClick={() => { if (start.current) onLayout(start.current); onDone(); }}>Anuluj</button>
      <button type="button" className="btn primary" onClick={onDone}>Gotowe</button></div>}
    <div ref={board} className="bgrid" onPointerOver={fullTitle} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: ROW_H, gap: GAP, minHeight: total ? total * stepY - GAP : undefined }}>
      {editing && Array.from({ length: total * cols }, (_, index) => <i key={`c${index}`} className="bcell" aria-hidden="true" style={{ gridColumn: (index % cols) + 1, gridRow: Math.floor(index / cols) + 1 }} />)}
      {g?.kind === 'drag' && g.active && (() => { const slot = placed.find((item) => item.id === g.id)!; return <i className="bslot" aria-hidden="true" style={{ gridColumn: `${slot.x + 1} / span ${slot.w}`, gridRow: `${slot.y + 1} / span ${slot.h}` }} />; })()}
      {placed.map((tile) => {
        const dragging = g?.id === tile.id && (g.kind === 'resize' || g.active);
        const shift = dragShift && g?.id === tile.id ? dragShift : null;
        return <div key={tile.id} ref={(element) => { if (element) elements.current.set(tile.id, element); else elements.current.delete(tile.id); }}
          className={`tile${dragging ? ` is-${g!.kind}` : ''} h${Math.min(tile.h, 3)}`} data-own-keys={editing ? '' : undefined}
          style={{ gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1} / span ${tile.h}`, ...(shift ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : {}) }}
          tabIndex={editing ? 0 : undefined} aria-label={editing ? `${tileLabel(tile.id)}, ${tile.w}×${tile.h}. Strzałki przenoszą, Shift+strzałki zmieniają rozmiar, Delete usuwa.` : undefined}
          onKeyDown={(event) => key(event, tile)}
          onPointerDown={(event) => down(event, tile, 'drag')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="tile-body">{render(tile)}</div>
          {editing && <div className="tile-edit">
            <button type="button" className="tile-grip" data-grip aria-hidden="true" tabIndex={-1} title="Przeciągnij"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg></button>
            <span className="tile-tools">
              {isStat(tile.id) && <button type="button" className="iconbtn" title="Przenieś do tabeli „Wskaźniki dobowe”" aria-label={`Przenieś do tabeli: ${tileLabel(tile.id)}`} onClick={() => onLayout(toTable(layout, tile.id as StatId))}><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h9M17 15l3 3-3 3" /></svg></button>}
              <button type="button" className="iconbtn" title="Usuń kafelek" aria-label={`Usuń kafelek: ${tileLabel(tile.id)}`} onClick={() => onLayout(removeTile(layout, tile.id))}><CloseIcon /></button>
            </span>
            <span className="tile-size">{tile.w}×{tile.h}</span>
            <div className="tile-resize" title="Zmień rozmiar" aria-hidden="true" onPointerDown={(event) => down(event, tile, 'resize')} />
          </div>}
        </div>;
      })}
      {g?.kind === 'resize' && (() => { const slot = placed.find((item) => item.id === g.id)!; return <i className="rghost" aria-hidden="true" style={{ left: slot.x * stepX, top: slot.y * stepY, width: Math.max(colW, g.w0 + g.x - g.x0), height: Math.max(ROW_H, g.h0 + g.y - g.y0) }} />; })()}
    </div>
    {editing && layout.tiles.length === 0 && <p className="sub">Brak kafelków. Dodaj je przyciskiem „+ Kafelki”.</p>}
    {catalog && <TileCatalog layout={layout} onLayout={onLayout} onClose={() => setCatalog(false)} />}
  </section>;
}

/** Every tile the app offers, with its place: a tile, a row of the table (stats only) or hidden. */
function TileCatalog({ layout, onLayout, onClose }: { layout: DayLayout; onLayout: (layout: DayLayout) => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  const tableShown = placeOf(layout, 'summaries') === 'tile';
  // like the chart zoom: the dialog starts below the sticky top bar, which stays above it
  const top = Math.max(0, Math.round(document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0));
  return <><div className="scrim zscrim" onClick={onClose} /><section ref={ref} className="zoom tilecat" style={{ top: top + 8, maxHeight: `calc(100% - ${top + 16}px)` }} role="dialog" aria-modal="true" aria-labelledby="cattitle">
    <header><div><h2 id="cattitle">Kafelki dnia</h2><p>Statystyka może być osobnym kafelkiem albo wierszem tabeli „Wskaźniki dobowe”.</p></div><div className="zctl"><button type="button" className="iconbtn" onClick={onClose} aria-label="Zamknij"><CloseIcon /></button></div></header>
    <div className="catbody">{catalogGroups.map(([title, color, ids]) => <section key={title}><h3><i style={{ background: color }} />{title}</h3>
      {ids.map((id) => {
        const place = placeOf(layout, id), options: [Place, string][] = isStat(id) ? [['tile', 'Kafelek'], ['table', 'W tabeli'], ['hidden', 'Ukryty']] : [['tile', 'Widoczny'], ['hidden', 'Ukryty']];
        return <div className="catrow" key={id}><span>{tileLabel(id)}{place === 'table' && !tableShown && <small> · tabela ukryta</small>}</span>
          <Segmented label={tileLabel(id)} items={options} value={place} onChange={(next) => onLayout(setPlace(layout, id, next))} /></div>;
      })}</section>)}
    </div></section></>;
}

