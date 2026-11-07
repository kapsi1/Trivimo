import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addTile, defaultLayout, dropOn, pack, packedRows, parseLayout, placeOf, resizeTile, serializeLayout, setPlace, tileSpecs, toTable, type Placed, type Tile } from '../apps/web/src/day-layout.ts';

const at = (placed: Placed[]) => Object.fromEntries(placed.map((item) => [item.id, `${item.x},${item.y} ${item.w}x${item.h}`]));

test('układ domyślny na 12 kolumnach odtwarza dawny układ dnia', () => {
  assert.deepEqual(at(pack(defaultLayout().tiles, 12)), {
    'metric:weight': '0,0 2x1', 'metric:body_fat': '2,0 2x1', 'metric:total_energy': '4,0 4x2', 'metric:steps': '8,0 4x2',
    hr: '0,1 4x2', 'metric:active_energy': '4,2 4x2', 'metric:distance': '8,2 4x2', note: '0,3 4x1', summaries: '0,4 12x3',
  });
});

test('na 4 kolumnach kolejność zostaje, szersze kafelki są zwężane, nic się nie nakłada', () => {
  const placed = pack(defaultLayout().tiles, 4);
  assert.equal(placed.find((item) => item.id === 'summaries')!.w, 4);
  const cells = new Set<string>();
  for (const item of placed) for (let y = item.y; y < item.y + item.h; y++) for (let x = item.x; x < item.x + item.w; x++) {
    assert.ok(x < 4); const key = `${x},${y}`; assert.ok(!cells.has(key), key); cells.add(key);
  }
  assert.deepEqual(placed.map((item) => item.id), defaultLayout().tiles.map((tile) => tile.id));
});

test('zamiana kafelków o tych samych wymiarach nie przesuwa pozostałych (także niesąsiadujących)', () => {
  for (const [a, b] of [['metric:total_energy', 'metric:steps'], ['metric:weight', 'metric:body_fat'], ['metric:steps', 'hr'], ['hr', 'metric:distance']] as const) {
    const tiles = defaultLayout().tiles, before = at(pack(tiles, 12)), after = at(pack(dropOn(tiles, a, b, 12), 12));
    for (const id of Object.keys(before)) if (id !== a && id !== b) assert.equal(after[id], before[id], `${a}↔${b}: ${id}`);
    assert.equal(after[a], before[b]); assert.equal(after[b], before[a]);
  }
});

test('upuszczenie na kafelek innego rozmiaru przenosi w kolejności na jego miejsce', () => {
  const tiles = defaultLayout().tiles;
  const ids = (list: Tile[]) => list.map((tile) => tile.id);
  assert.deepEqual(ids(dropOn(tiles, 'note', 'metric:total_energy', 12)).slice(0, 4), ['metric:weight', 'metric:body_fat', 'note', 'metric:total_energy']);
  assert.deepEqual(ids(dropOn(tiles, 'metric:weight', 'hr', 12)).slice(0, 5), ['metric:body_fat', 'metric:total_energy', 'metric:steps', 'hr', 'metric:weight']);
  assert.equal(dropOn(tiles, 'hr', 'hr', 12), tiles);
});

test('rozmiar w krokach z granicami kafelka', () => {
  const tiles = resizeTile(defaultLayout().tiles, 'note', { w: 1.4, h: 40 });
  assert.deepEqual(tiles.find((tile) => tile.id === 'note'), { id: 'note', w: 3, h: 6 });
  assert.deepEqual(resizeTile(tiles, 'summaries', { w: 99, h: 0 }).find((tile) => tile.id === 'summaries'), { id: 'summaries', w: 12, h: 2 });
});

test('statystyka jest kafelkiem, wierszem tabeli albo ukryta — nigdy w dwóch miejscach', () => {
  let layout = defaultLayout();
  assert.equal(placeOf(layout, 'summary:daily-vo2-max'), 'table');
  layout = setPlace(layout, 'summary:daily-vo2-max', 'tile');
  assert.equal(placeOf(layout, 'summary:daily-vo2-max'), 'tile');
  assert.ok(!layout.table.includes('summary:daily-vo2-max'));
  assert.equal(layout.tiles.findIndex((tile) => tile.id === 'summary:daily-vo2-max') + 1, layout.tiles.findIndex((tile) => tile.id === 'summaries'), 'wyciągnięty kafelek stoi przed tabelą');
  layout = toTable(layout, 'metric:weight');
  assert.equal(placeOf(layout, 'metric:weight'), 'table');
  assert.deepEqual(layout.table.slice(0, 1), ['metric:weight'], 'wiersze w kolejności katalogu');
  layout = setPlace(layout, 'metric:weight', 'hidden');
  assert.equal(placeOf(layout, 'metric:weight'), 'hidden');
  // moving into the table brings back a removed table tile
  layout = toTable(setPlace(layout, 'summaries', 'hidden'), 'metric:steps');
  assert.equal(placeOf(layout, 'summaries'), 'tile');
  assert.equal(addTile(layout, 'hr'), layout, 'kafelek już jest');
});

test('odczyt zapisu: śmieci → domyślny, nieznane i powtórzone id pominięte, nowe id w domyślnym miejscu bez przywracania usuniętej tabeli', () => {
  assert.deepEqual(parseLayout(null), defaultLayout());
  assert.deepEqual(parseLayout({ v: 2, tiles: [] }), defaultLayout());
  const saved = serializeLayout({ ...defaultLayout(), tiles: [{ id: 'hr', w: 5, h: 2 }], table: [] });
  assert.deepEqual(parseLayout(JSON.parse(JSON.stringify(saved))), { ...defaultLayout(), tiles: [{ id: 'hr', w: 5, h: 2 }], table: [] });
  const old = { v: 1, tiles: [{ id: 'hr', w: 4, h: 2 }, { id: 'hr', w: 2, h: 2 }, { id: 'bogus', w: 2, h: 1 }, { id: 'note', w: 'x', h: 1 }, { id: 'metric:weight', w: 2, h: 1 }], table: ['metric:weight', 'summary:daily-vo2-max'], seen: tileSpecs.map((item) => item.id).filter((id) => id !== 'summary:daily-vo2-max' && id !== 'metric:steps') };
  const layout = parseLayout(old);
  assert.deepEqual(layout.tiles.map((tile) => tile.id), ['hr', 'metric:weight', 'metric:steps']);
  assert.deepEqual(layout.table, ['summary:daily-vo2-max'], 'kafelek ma pierwszeństwo przed wierszem; nowa statystyka trafia do tabeli');
  assert.equal(placeOf(layout, 'summaries'), 'hidden');
  assert.equal(packedRows(pack(layout.tiles, 12)), 2);
});
