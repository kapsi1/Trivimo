import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { dayZoneSchema, earliestOf, earliestSchema, metrics, post, syncStatusSchema, useJson } from './api.ts';
import { Tooltip } from './charts.tsx';
import { DayView, rememberDayScroll, type DayTab } from './day.tsx';
import { addDays, fmtDL, timeOf, appToday, whenOf , firstDay, setDayZone } from './format.ts';
import { Loading, LogoMark } from './logo.tsx';
import { BackfillNotice } from './notice.tsx';
import { FoodView, WorkoutsView, type FoodTab } from './placeholders.tsx';
import { SettingsView } from './settings.tsx';
import { SourcesView, type SourcesTab } from './sources.tsx';
import { ColumnsMenu, TableRange, TableView, tableBounds, tableMetricKeys, useTablePrefs } from './table.tsx';
import { aggregations, TrendsView } from './trends-view.tsx';
import { DateControl, Segmented } from './zoom.tsx';
import './fonts.css';
import './style.css';

const views = ['dzien', 'tabela', 'trendy', 'treningi', 'jedzenie', 'zrodla', 'ustawienia'] as const;
type View = (typeof views)[number];
const titles: Record<View, string> = { dzien: 'Dzień', tabela: 'Tabela dni', trendy: 'Trendy', treningi: 'Treningi', jedzenie: 'Jedzenie', zrodla: 'Źródła danych', ustawienia: 'Ustawienia' };
const dayTabs = ['przebieg', 'godzinowe', 'jedzenie', 'treningi'] as const satisfies readonly DayTab[];
const srcTabs = ['polaczenia', 'pokrycie', 'importy', 'diagnostyka'] as const satisfies readonly SourcesTab[];
const foodTabs = ['dziennik', 'produkty', 'planer', 'importy'] as const satisfies readonly FoodTab[];
interface Route { view: View; day: string; tab: string }
/**
 * Views and their sub-tabs are addressed by hash so a specific place can be reopened:
 * #dzien[/YYYY-MM-DD][/tab], #zrodla[/tab], #jedzenie[/tab], #tabela, … The default tab is left out of the address.
 */
function parseHash(hash: string): Route {
  const [view = '', ...rest] = hash.replace(/^#/, '').split('/');
  const day = rest[0] && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? rest.shift()! : '';
  return { view: (views as readonly string[]).includes(view) ? view as View : 'dzien', day, tab: rest[0] ?? '' };
}
const pick = <T extends string>(list: readonly T[], value: string): T => list.find((item) => item === value) ?? list[0]!;
const validDay = (param: string, today: string) => /^\d{4}-\d{2}-\d{2}$/.test(param) && param >= firstDay && param <= today && !Number.isNaN(Date.parse(param)) ? param : today;
const tabHash = (view: View, tab: string, list: readonly string[]) => tab === list[0] ? view : `${view}/${tab}`;
const dayHash = (day: string, tab: DayTab) => ['dzien', day === appToday() ? '' : day, tab === dayTabs[0] ? '' : tab].filter(Boolean).join('/');

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>;
const I = {
  day: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  table: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>),
  trend: icon(<><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></>),
  run: icon(<><circle cx="14" cy="4.5" r="1.8" /><path d="M6 20l3.5-5 3 2 1.5-5 3 3h3M9 11l3-3 3 1" /></>),
  food: icon(<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-2.5 5-2.5 8h3V3M17.5 11v10" />),
  book: icon(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>),
  plan: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  src: icon(<><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" /></>),
  gear: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4z" /></>),
  more: icon(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>),
  left: icon(<path d="M15 5l-7 7 7 7" />), right: icon(<path d="M9 5l7 7-7 7" />), plus: icon(<path d="M12 5v14M5 12h14" />),
};

function App() {
  const [session, setSession] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => { fetch('/api/session').then((response) => setSession(response.ok ? 'ok' : 'error'), () => setSession('error')); }, []);
  if (session === 'loading') return <Loading size="page" />;
  if (session === 'error') return <p className="boot" role="alert">Nie udało się połączyć z lokalnym serwerem Trivimo. Sprawdź, czy serwer działa (npm run dev).</p>;
  return <Shell />;
}

function Shell() {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const [trendAgg, setTrendAgg] = useState<'day' | 'week'>('day');
  // one period shared by the table and the trends
  const [prefs, setPrefs] = useTablePrefs();
  const trendPrefs = prefs, setTrendPrefs = setPrefs;
  const earliestAll = useJson(prefs.range < 0 || trendPrefs.range < 0 ? '/api/earliest-days' : null, earliestSchema);
  const tableEarliest = earliestOf(earliestAll, tableMetricKeys(prefs.cols)), trendEarliest = earliestOf(earliestAll, [...metrics.map((metric) => metric.key), 'hr']);
  const [addOpen, setAddOpen] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false), [refreshFailed, setRefreshFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('trivimo-side') === 'collapsed'; } catch { return false; } });
  const toggleSide = () => setCollapsed((value) => { try { localStorage.setItem('trivimo-side', value ? 'open' : 'collapsed'); } catch { /* per-browser convenience only */ } return !value; });
  const dirty = useRef(false);
  const current = useRef(location.hash);
  const today = appToday();
  const date = validDay(route.day, today);
  // the Dzień tab reopens on the day last shown there (kept while the app is open), not on today
  const lastDay = useRef<string>(null as unknown as string);
  if (lastDay.current === null) { try { lastDay.current = localStorage.getItem('trivimo-day') ?? today; } catch { lastDay.current = today; } }
  if (route.view === 'dzien' && lastDay.current !== date) {
    lastDay.current = date;
    try { localStorage.setItem('trivimo-day', date); } catch { /* per-browser convenience only */ }
  }
  const dayLink = dayHash(validDay(lastDay.current, today), dayTabs[0]);
  const dayTab = pick(dayTabs, route.tab), srcTab = pick(srcTabs, route.tab), foodTab = pick(foodTabs, route.tab);
  const sync = useJson('/api/google/sync-status', syncStatusSchema, syncTick);
  // poll often while a refresh runs, so the day in progress updates as soon as its new snapshot is published
  const running = (sync.data?.running ?? false) || sync.data?.backfill?.state === 'running' || sync.data?.backfill?.state === 'stopping';
  useEffect(() => { const timer = setInterval(() => setSyncTick((value) => value + 1), running ? 2000 : 10000); return () => clearInterval(timer); }, [running]);

  // Leaving the day with an unsaved note asks first; a cancelled change restores the address without a new entry.
  useEffect(() => {
    const change = () => {
      const next = parseHash(location.hash), previous = parseHash(current.current);
      const leaving = previous.view === 'dzien' && (next.view !== 'dzien' || validDay(next.day, appToday()) !== validDay(previous.day, appToday()));
      if (leaving && dirty.current && !window.confirm('Notatka ma niezapisane zmiany. Opuścić ten dzień?')) { history.replaceState(null, '', current.current || '#dzien'); return; }
      if (leaving) dirty.current = false;
      current.current = location.hash; setRoute(next); setAddOpen(false);
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('hashchange', change); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('beforeunload', unload); };
  }, []);
  const go = useCallback((hash: string) => { if (location.hash === `#${hash}`) return; location.hash = hash; }, []);
  const setDay = (next: string, tab: DayTab = route.view === 'dzien' ? dayTab : dayTabs[0]) => { if (next < firstDay || next > appToday()) return; if (route.view === 'dzien' && next !== date) rememberDayScroll(); go(dayHash(next, tab)); };
  const openDay = (next: string, tab: DayTab = dayTabs[0]) => setDay(next, tab);;

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && addOpen) { setAddOpen(false); return; }
      if (route.view !== 'dzien' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') setDay(addDays(date, -1));
      else if (event.key === 'ArrowRight') setDay(addDays(date, 1));
      else if (event.key === 't') setDay(appToday());
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => { if (!addOpen) return; const close = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('.menuwrap'))) setAddOpen(false); }; document.addEventListener('click', close); return () => document.removeEventListener('click', close); }, [addOpen]);

  // the footer does what "Odśwież teraz" in Źródła danych does
  const refreshNow = async () => {
    setRefreshing(true); setRefreshFailed(false);
    try { const response = await post('/api/google/sync', {}); if (!response.ok) throw new Error('sync'); } catch { setRefreshFailed(true); } finally { setRefreshing(false); setSyncTick((value) => value + 1); }
  };
  const syncData = sync.data;
  const refreshBusy = refreshing || !!syncData?.running;
  const lastOk = syncData?.last?.result === 'ok' ? syncData.last.at : syncData?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  const syncBad = sync.error || (syncData?.last && syncData.last.result !== 'ok');
  const nav = (view: View, ic: ReactNode, label: string, hash: string = view, soon = false, href: string = hash) => <a className={`nav ${soon ? 'is-soon' : ''}`} href={`#${href}`} aria-current={route.view === view && (hash === view || (view === 'jedzenie' ? foodTab : route.tab) === hash.split('/')[1]) ? 'page' : undefined}>{ic}<span>{label}</span></a>;
  const bottom = (view: View, ic: ReactNode, label: string) => <button type="button" aria-current={route.view === view ? 'page' : undefined} onClick={() => go(view === 'dzien' ? dayLink : view)}>{ic}<span>{label}</span></button>;

  let context: ReactNode = null;
  if (route.view === 'dzien') context = <DateControl date={date} onDate={setDay} />;
  if (route.view === 'tabela') context = <><ColumnsMenu cols={prefs.cols} onChange={(cols) => setPrefs({ cols: { ...prefs.cols, ...cols } })} /><TableRange prefs={prefs} earliest={tableEarliest} onChange={setPrefs} /></>;
  if (route.view === 'trendy') context = <><TableRange prefs={trendPrefs} earliest={trendEarliest} onChange={setTrendPrefs} /><Segmented className="hide-sm" label="Agregacja" items={aggregations} value={trendAgg} onChange={setTrendAgg} /></>;

  let content: ReactNode;
  if (route.view === 'dzien') content = <DayView date={date} tab={dayTab} onTab={(tab) => setDay(date, tab)} sync={syncData} onDirty={(value) => { dirty.current = value; }} />;
  else if (route.view === 'tabela') content = <TableView {...tableBounds(prefs, tableEarliest)} cols={prefs.cols} onOpenDay={(next) => openDay(next)} onOpenMetric={(next) => openDay(next)} />;
  else if (route.view === 'trendy') content = <TrendsView earliest={earliestAll} prefs={trendPrefs} agg={trendAgg} />;
  else if (route.view === 'treningi') content = <WorkoutsView />;
  else if (route.view === 'jedzenie') content = <FoodView tab={foodTab} onTab={(tab) => go(tabHash('jedzenie', tab, foodTabs))} />;
  else if (route.view === 'zrodla') content = <SourcesView tab={srcTab} onTab={(tab) => go(tabHash('zrodla', tab, srcTabs))} sync={syncData} onSyncChanged={() => setSyncTick((value) => value + 1)} />;
  else content = <SettingsView />;

  return <div className={`app ${collapsed ? 'collapsed' : ''}`}>
    <BackfillNotice backfill={syncData?.backfill} onCoverage={route.view === 'zrodla' && srcTab === 'pokrycie'} go={go} />
    <aside className="side" aria-label="Nawigacja główna">
      <div className="brand"><LogoMark className="brand-mark" /><b>Trivimo</b><button type="button" className="sidetoggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Rozwiń panel nawigacji' : 'Zwiń panel do ikon'} title={collapsed ? 'Rozwiń panel' : 'Zwiń panel'} onClick={toggleSide}>{collapsed ? I.right : I.left}</button></div>
      <nav className="navgroup" aria-label="Dane"><h4>Dane</h4>{nav('dzien', I.day, 'Dzień', 'dzien', false, dayLink)}{nav('trendy', I.trend, 'Trendy')}{nav('tabela', I.table, 'Tabela dni')}{nav('treningi', I.run, 'Treningi', 'treningi', true)}</nav>
      <nav className="navgroup" aria-label="Jedzenie"><h4>Jedzenie</h4>{nav('jedzenie', I.book, 'Dziennik', 'jedzenie/dziennik', true)}{nav('jedzenie', I.food, 'Produkty i przepisy', 'jedzenie/produkty', true)}{nav('jedzenie', I.plan, 'Planer', 'jedzenie/planer', true)}</nav>
      <nav className="navgroup" aria-label="System"><h4>System</h4>{nav('zrodla', I.src, 'Źródła danych')}{nav('ustawienia', I.gear, 'Ustawienia')}</nav>
      <div className="side-foot"><button type="button" className="sync" disabled={refreshBusy} title={`${sync.error ? 'Stan niedostępny' : lastOk ? `Odświeżono ${whenOf(lastOk)}` : 'Brak odczytu'}${syncData?.automatic ? ` · automatycznie co ${syncData.automatic} min` : ''} · kliknij, aby odświeżyć teraz`} onClick={() => void refreshNow()}><span className={`dot ${syncBad || refreshFailed ? 'warn' : ''} ${refreshBusy ? 'busy' : ''}`} /><span>{refreshBusy ? 'odświeżanie…' : refreshFailed ? 'nie udało się odświeżyć' : sync.error ? 'stan niedostępny' : lastOk ? `odświeżono ${whenOf(lastOk).replace(/^dziś /, '')}` : 'brak odczytu'}{!refreshBusy && !refreshFailed && syncBad && syncData?.last ? ' · błąd' : ''}</span></button></div>
    </aside>
    <div className="main">
      <header className="topbar"><h1>{route.view === 'dzien' ? fmtDL(date) : titles[route.view]}</h1>{route.view === 'dzien' && date === appToday() && <span className="live">w toku{lastOk ? ` · stan na ${timeOf(lastOk)}` : ''}</span>}{context}
        <div className="menuwrap"><button type="button" className="btn primary" aria-label="Dodaj" title="Dodaj" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>{I.plus}<span className="hide-sm">Dodaj</span></button>
          {addOpen && <div className="menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAddOpen(false); setDay(route.view === 'dzien' ? date : appToday(), 'przebieg'); setTimeout(() => document.getElementById('usernote')?.focus(), 150); }}>Notatka do dnia</button>
            <button type="button" role="menuitem" disabled>Posiłek</button><button type="button" role="menuitem" disabled>Pomiar wagi</button></div>}</div></header>
      <main className="content">{content}</main>
    </div>
    <nav className="bottomnav" aria-label="Nawigacja">{bottom('dzien', I.day, 'Dzień')}{bottom('trendy', I.trend, 'Trendy')}{bottom('tabela', I.table, 'Dni')}{bottom('jedzenie', I.food, 'Jedzenie')}{bottom('zrodla', I.more, 'Więcej')}</nav>
    <Tooltip />
  </div>;
}

/** The day zone is read once before the first render: every view formats days and times in it (a change reloads the page). */
function Root() {
  const [zone, setZone] = useState<{ value: string | null } | null>(null);
  useEffect(() => {
    void (async () => {
      let value: string | null = null;
      try {
        await fetch('/api/session'); // the setting needs the session cookie
        const response = await fetch('/api/settings/day-zone');
        if (response.ok) value = dayZoneSchema.parse(await response.json()).zone;
      } catch { /* unreadable setting (no store yet): the views show their own unavailable states, in the default zone of a new store */ }
      if (value) setDayZone(value);
      setZone({ value });
    })();
  }, []);
  if (!zone) return <Loading />;
  return <App key={zone.value ?? 'default'} />;
}

createRoot(document.getElementById('root')!).render(<Root />);
