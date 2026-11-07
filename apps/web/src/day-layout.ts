import type { MetricKey } from './api.ts';
import { summaryMainKey, type SummaryType } from './summary-number.ts';

/**
 * Tile layout of the day view ("Przebieg doby"): an ordered list of tiles with sizes in grid steps.
 * Positions are not stored: `pack` places the tiles in list order, each at the first free spot (top to bottom,
 * left to right) where it fits. The same order therefore reflows to any column count, and swapping two tiles of the
 * same size swaps their places without moving any other tile.
 */

/** Columns of the widest grid; narrower screens use 8 or 4 and clamp wider tiles. */
export const GRID_COLS = 12;
/** One vertical step in px; two steps plus the gap are the former chart tile (206 px). */
export const ROW_H = 96;
export const GAP = 14;
export const colsFor = (width: number) => width >= 1000 ? 12 : width >= 620 ? 8 : 4;

const metricKeys = ['weight', 'body_fat', 'total_energy', 'active_energy', 'steps', 'distance'] as const satisfies readonly MetricKey[];
const summaryTypes = Object.keys(summaryMainKey) as SummaryType[];
export type StatId = `metric:${(typeof metricKeys)[number]}` | `summary:${SummaryType}`;
export type TileId = StatId | 'hr' | 'note' | 'summaries';
export interface TileSize { w: number; h: number }
export interface Tile extends TileSize { id: TileId }
export interface Placed extends Tile { x: number; y: number }
/** `table`: stats shown as rows of the "Wskaźniki dobowe" tile; a stat is a tile, a row or hidden, never two of them. `seen`: ids known when saved (a later new id gets its default place). */
export interface DayLayout { tiles: Tile[]; table: StatId[]; seen: TileId[] }
export interface TileSpec { id: TileId; size: TileSize; min: TileSize; max: TileSize; place: 'tile' | 'table' | 'hidden' }

const spec = (id: TileId, size: TileSize, min: TileSize, place: TileSpec['place'] = 'tile', max: TileSize = { w: GRID_COLS, h: 6 }): TileSpec => ({ id, size, min, max, place });
/** Catalog order; also the order of the table rows. A stat added to the app later appears here and lands in its default place once. */
export const tileSpecs: TileSpec[] = [
  spec('metric:weight', { w: 2, h: 1 }, { w: 2, h: 1 }),
  spec('metric:body_fat', { w: 2, h: 1 }, { w: 2, h: 1 }),
  spec('metric:total_energy', { w: 4, h: 2 }, { w: 2, h: 1 }),
  spec('metric:active_energy', { w: 4, h: 2 }, { w: 2, h: 1 }),
  spec('metric:steps', { w: 4, h: 2 }, { w: 2, h: 1 }),
  spec('metric:distance', { w: 4, h: 2 }, { w: 2, h: 1 }),
  spec('hr', { w: 4, h: 2 }, { w: 3, h: 1 }),
  spec('note', { w: 4, h: 1 }, { w: 3, h: 1 }),
  spec('summaries', { w: 12, h: 3 }, { w: 4, h: 2 }, 'tile', { w: GRID_COLS, h: 8 }),
  ...summaryTypes.map((type) => spec(`summary:${type}`, { w: 2, h: 1 }, { w: 2, h: 1 }, 'table')),
];
const specs = new Map(tileSpecs.map((item) => [item.id, item]));
export const specOf = (id: TileId) => specs.get(id)!;
export const isStat = (id: TileId): id is StatId => id.startsWith('metric:') || id.startsWith('summary:');

/** The former fixed layout: body pair, heart rate and note on the left, energy and activity columns, the table below. */
const defaultOrder: TileId[] = ['metric:weight', 'metric:body_fat', 'metric:total_energy', 'metric:steps', 'hr', 'metric:active_energy', 'metric:distance', 'note', 'summaries'];
export function defaultLayout(): DayLayout {
  return {
    tiles: defaultOrder.map((id) => ({ id, ...specOf(id).size })),
    table: tileSpecs.filter((item) => item.place === 'table').map((item) => item.id as StatId),
    seen: tileSpecs.map((item) => item.id),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export const clampSize = (id: TileId, size: TileSize): TileSize => { const { min, max } = specOf(id); return { w: clamp(Math.round(size.w), min.w, max.w), h: clamp(Math.round(size.h), min.h, max.h) }; };
/** Size on a grid of `cols` columns (wider tiles are narrowed, never wrapped). */
export const sizeIn = (tile: TileSize, cols: number): TileSize => ({ w: Math.min(tile.w, cols), h: tile.h });

/** First-fit placement in list order. Depends only on the sequence of sizes. */
export function pack(tiles: Tile[], cols: number): Placed[] {
  const rows: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (rows[r]?.[c]) return false;
    return true;
  };
  return tiles.map((tile) => {
    const { w, h } = sizeIn(tile, cols);
    for (let y = 0; ; y++) for (let x = 0; x + w <= cols; x++) {
      if (!free(x, y, w, h)) continue;
      for (let r = y; r < y + h; r++) { rows[r] ??= []; for (let c = x; c < x + w; c++) rows[r][c] = true; }
      return { ...tile, w, h, x, y };
    }
  });
}
export const packedRows = (placed: Placed[]) => placed.reduce((most, item) => Math.max(most, item.y + item.h), 0);
export const tileAt = (placed: Placed[], x: number, y: number) => placed.find((item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h);

export function moveTile(tiles: Tile[], from: number, to: number): Tile[] {
  const next = tiles.slice(), [tile] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, tile);
  return next;
}
/**
 * Drop of `dragId` on `targetId`: tiles of the same size (as shown on `cols` columns) swap places and nothing else moves;
 * otherwise the dragged tile takes the target's place in the order and the tiles between shift by one.
 */
export function dropOn(tiles: Tile[], dragId: TileId, targetId: TileId, cols: number): Tile[] {
  const from = tiles.findIndex((tile) => tile.id === dragId), to = tiles.findIndex((tile) => tile.id === targetId);
  if (from < 0 || to < 0 || from === to) return tiles;
  const a = sizeIn(tiles[from], cols), b = sizeIn(tiles[to], cols);
  if (a.w !== b.w || a.h !== b.h) return moveTile(tiles, from, to);
  const next = tiles.slice(); [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export const resizeTile = (tiles: Tile[], id: TileId, size: TileSize): Tile[] => tiles.map((tile) => tile.id === id ? { id, ...clampSize(id, size) } : tile);

const byCatalog = (ids: StatId[]) => tileSpecs.map((item) => item.id).filter((id): id is StatId => ids.includes(id as StatId));
export function removeTile(layout: DayLayout, id: TileId): DayLayout { return { ...layout, tiles: layout.tiles.filter((tile) => tile.id !== id) }; }
/** Adds a tile in its default size; a stat leaves the table. `before`: insert before this tile (else at the end). */
export function addTile(layout: DayLayout, id: TileId, before?: TileId): DayLayout {
  if (layout.tiles.some((tile) => tile.id === id)) return layout;
  const tiles = layout.tiles.slice(), at = before ? tiles.findIndex((tile) => tile.id === before) : -1;
  tiles.splice(at < 0 ? tiles.length : at, 0, { id, ...specOf(id).size });
  return { ...layout, tiles, table: layout.table.filter((stat) => stat !== id) };
}
/** Moves a stat into the table (and shows the table tile if it was removed). */
export function toTable(layout: DayLayout, id: StatId): DayLayout {
  const base = removeTile(layout, id), table = byCatalog([...base.table.filter((stat) => stat !== id), id]);
  return base.tiles.some((tile) => tile.id === 'summaries') ? { ...base, table } : { ...addTile(base, 'summaries'), table };
}
export function removeFromTable(layout: DayLayout, id: StatId): DayLayout { return { ...layout, table: layout.table.filter((stat) => stat !== id) }; }
export type Place = 'tile' | 'table' | 'hidden';
export const placeOf = (layout: DayLayout, id: TileId): Place => layout.tiles.some((tile) => tile.id === id) ? 'tile' : isStat(id) && layout.table.includes(id) ? 'table' : 'hidden';
export function setPlace(layout: DayLayout, id: TileId, place: Place): DayLayout {
  if (placeOf(layout, id) === place) return layout;
  if (place === 'table' && isStat(id)) return toTable(layout, id);
  const base = isStat(id) ? removeFromTable(removeTile(layout, id), id) : removeTile(layout, id);
  return place === 'tile' ? addTile(base, id, isStat(id) && placeOf(layout, id) === 'table' ? 'summaries' : undefined) : base;
}

/** Saved layout (version 1) → valid layout: unknown and repeated ids dropped, sizes clamped, a stat in one place; new ids get their default place. */
export function parseLayout(raw: unknown): DayLayout {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return defaultLayout();
  const { tiles, table, seen } = raw as { tiles?: unknown; table?: unknown; seen?: unknown };
  if (!Array.isArray(tiles) || !Array.isArray(table) || !Array.isArray(seen)) return defaultLayout();
  const used = new Set<TileId>();
  const out: Tile[] = [];
  for (const item of tiles) {
    const { id, w, h } = (item ?? {}) as { id?: unknown; w?: unknown; h?: unknown };
    if (typeof id !== 'string' || !specs.has(id as TileId) || used.has(id as TileId) || typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    used.add(id as TileId); out.push({ id: id as TileId, ...clampSize(id as TileId, { w, h }) });
  }
  let layout: DayLayout = { tiles: out, table: byCatalog(table.filter((id): id is StatId => typeof id === 'string' && specs.has(id as TileId) && isStat(id as TileId) && !used.has(id as TileId))), seen: [] };
  const known = new Set(seen.filter((id): id is string => typeof id === 'string'));
  // a new stat joins the table without bringing back a table tile the user removed
  for (const item of tileSpecs) if (!known.has(item.id) && placeOf(layout, item.id) === 'hidden') {
    if (item.place === 'table' && isStat(item.id)) layout = { ...layout, table: byCatalog([...layout.table, item.id]) };
    else if (item.place === 'tile') layout = addTile(layout, item.id);
  }
  return { ...layout, seen: tileSpecs.map((item) => item.id) };
}
export const serializeLayout = (layout: DayLayout) => ({ v: 1, tiles: layout.tiles, table: layout.table, seen: layout.seen });
