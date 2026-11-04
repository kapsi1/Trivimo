import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { syncStatusSchema, useJson } from './api.ts';
import { Tooltip } from './charts.tsx';
import { DayView, type DayTab } from './day.tsx';
import { Drawer, type DrawerState } from './details.tsx';
import { addDays, warsawToday, whenOf } from './format.ts';
import { FoodView, WorkoutsView } from './placeholders.tsx';
import { SettingsView } from './settings.tsx';
import { SourcesView, type SourcesTab } from './sources.tsx';
import { TableView, tableRanges, useTablePrefs } from './table.tsx';
import { aggregations, trendRanges, TrendsView, type TrendLength } from './trends-view.tsx';
import { DateControl, Segmented } from './zoom.tsx';
import './fonts.css';
import './style.css';

const views = ['dzien', 'tabela', 'trendy', 'treningi', 'jedzenie', 'zrodla', 'ustawienia'] as const;
type View = (typeof views)[number];
const titles: Record<View, string> = { dzien: 'Dzień', tabela: 'Tabela dni', trendy: 'Trendy', treningi: 'Treningi', jedzenie: 'Jedzenie', zrodla: 'Źródła danych', ustawienia: 'Ustawienia' };
interface Route { view: View; param: string }
/** Views are addressed by hash (#dzien, #dzien/2026-11-03, #tabela, …) so a specific view can be reopened. */
function parseHash(hash: string): Route {
  const [view = '', param = ''] = hash.replace(/^#/, '').split('/');
  return { view: (views as readonly string[]).includes(view) ? view as View : 'dzien', param };
}
const validDay = (param: string, today: string) => /^\d{4}-\d{2}-\d{2}$/.test(param) && param >= '2026-01-01' && param <= today && !Number.isNaN(Date.parse(param)) ? param : today;

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
  if (session === 'loading') return <p className="boot">Ładowanie…</p>;
  if (session === 'error') return <p className="boot" role="alert">Nie udało się połączyć z lokalnym serwerem Trivimo. Sprawdź, czy serwer działa (npm run dev).</p>;
  return <Shell />;
}

function Shell() {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const [dayTab, setDayTab] = useState<DayTab>('przebieg');
  const [srcTab, setSrcTab] = useState<SourcesTab>('polaczenia');
  const [trendLength, setTrendLength] = useState<TrendLength>(90);
  const [trendAgg, setTrendAgg] = useState<'day' | 'week'>('day');
  const [prefs, setPrefs] = useTablePrefs();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('trivimo-side') === 'collapsed'; } catch { return false; } });
  const toggleSide = () => setCollapsed((value) => { try { localStorage.setItem('trivimo-side', value ? 'open' : 'collapsed'); } catch { /* per-browser convenience only */ } return !value; });
  const dirty = useRef(false);
  const current = useRef(location.hash);
  const today = warsawToday();
  const date = validDay(route.param, today);
  const sync = useJson('/api/google/sync-status', syncStatusSchema, syncTick);
  // poll often while a refresh runs, so the day in progress updates as soon as its new snapshot is published
  const running = sync.data?.running ?? false;
  useEffect(() => { const timer = setInterval(() => setSyncTick((value) => value + 1), running ? 5000 : 60000); return () => clearInterval(timer); }, [running]);

  // Leaving the day with an unsaved note asks first; a cancelled change restores the address without a new entry.
  useEffect(() => {
    const change = () => {
      const next = parseHash(location.hash), previous = parseHash(current.current);
      const leaving = previous.view === 'dzien' && (next.view !== 'dzien' || validDay(next.param, warsawToday()) !== validDay(previous.param, warsawToday()));
      if (leaving && dirty.current && !window.confirm('Notatka ma niezapisane zmiany. Opuścić ten dzień?')) { history.replaceState(null, '', current.current || '#dzien'); return; }
      if (leaving) dirty.current = false;
      current.current = location.hash; setRoute(next); setDrawer(null); setAddOpen(false);
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('hashchange', change); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('beforeunload', unload); };
  }, []);
  const go = useCallback((hash: string) => { if (location.hash === `#${hash}`) return; location.hash = hash; }, []);
  const setDay = (next: string) => { if (next < '2026-01-01' || next > warsawToday()) return; go(next === warsawToday() ? 'dzien' : `dzien/${next}`); };
  const openDay = (next: string, tab: DayTab = 'przebieg') => { setDayTab(tab); setDrawer(null); setDay(next); if (route.view === 'dzien' && next === date) setRoute({ ...route }); };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && addOpen) { setAddOpen(false); return; }
      if (route.view !== 'dzien' || document.querySelector('.drawer') || (document.querySelector('.zoom') && !document.querySelector('.zoom .datectl')) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') setDay(addDays(date, -1));
      else if (event.key === 'ArrowRight') setDay(addDays(date, 1));
      else if (event.key === 't') setDay(warsawToday());
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => { if (!addOpen) return; const close = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('.menuwrap'))) setAddOpen(false); }; document.addEventListener('click', close); return () => document.removeEventListener('click', close); }, [addOpen]);

  const syncData = sync.data;
  const lastOk = syncData?.last?.result === 'ok' ? syncData.last.at : syncData?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  const syncBad = sync.error || (syncData?.last && syncData.last.result !== 'ok');
  const nav = (view: View, ic: ReactNode, label: string, extra?: ReactNode, hash: string = view, soon = false) => <a className={`nav ${soon ? 'is-soon' : ''}`} href={`#${hash}`} aria-current={route.view === view && (hash === view || route.param === hash.split('/')[1]) ? 'page' : undefined}>{ic}<span>{label}</span>{extra}</a>;
  const bottom = (view: View, ic: ReactNode, label: string) => <button type="button" aria-current={route.view === view ? 'page' : undefined} onClick={() => go(view)}>{ic}<span>{label}</span></button>;

  let context: ReactNode = null;
  if (route.view === 'dzien') context = <DateControl date={date} onDate={setDay} />;
  if (route.view === 'tabela') context = <Segmented label="Zakres" items={tableRanges} value={prefs.range} onChange={(range) => setPrefs({ range })} />;
  if (route.view === 'trendy') context = <><Segmented label="Okres" items={trendRanges} value={trendLength} onChange={setTrendLength} /><Segmented className="hide-sm" label="Agregacja" items={aggregations} value={trendAgg} onChange={setTrendAgg} /></>;

  let content: ReactNode;
  if (route.view === 'dzien') content = <DayView date={date} tab={dayTab} onTab={setDayTab} onDate={setDay} sync={syncData} onDirty={(value) => { dirty.current = value; }} onDrawer={setDrawer} />;
  else if (route.view === 'tabela') content = <TableView range={prefs.range} cols={prefs.cols} onCols={(cols) => setPrefs({ cols: { ...prefs.cols, ...cols } })} onDrawer={setDrawer} onOpenDay={(next) => openDay(next)} />;
  else if (route.view === 'trendy') content = <TrendsView length={trendLength} agg={trendAgg} onLength={setTrendLength} onAgg={setTrendAgg} onDrawer={setDrawer} />;
  else if (route.view === 'treningi') content = <WorkoutsView />;
  else if (route.view === 'jedzenie') content = <FoodView key={route.param} initial={(['dziennik', 'produkty', 'planer', 'importy'] as const).find((tab) => tab === route.param)} />;
  else if (route.view === 'zrodla') content = <SourcesView tab={srcTab} onTab={setSrcTab} sync={syncData} onSyncChanged={() => setSyncTick((value) => value + 1)} />;
  else content = <SettingsView />;

  return <div className={`app ${collapsed ? 'collapsed' : ''}`}>
    <aside className="side" aria-label="Nawigacja główna">
      <div className="brand"><b>Trivimo</b><span>lokalnie</span><button type="button" className="sidetoggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Rozwiń panel nawigacji' : 'Zwiń panel do ikon'} title={collapsed ? 'Rozwiń panel' : 'Zwiń panel'} onClick={toggleSide}>{collapsed ? I.right : I.left}</button></div>
      <nav className="navgroup" aria-label="Dane"><h4>Dane</h4>{nav('dzien', I.day, 'Dzień')}{nav('tabela', I.table, 'Tabela dni')}{nav('trendy', I.trend, 'Trendy')}{nav('treningi', I.run, 'Treningi', <span className="tag soon">M2</span>, 'treningi', true)}</nav>
      <nav className="navgroup" aria-label="Jedzenie"><h4>Jedzenie</h4>{nav('jedzenie', I.book, 'Dziennik', <span className="tag soon food">M3</span>, 'jedzenie/dziennik', true)}{nav('jedzenie', I.food, 'Produkty i przepisy', <span className="tag soon food">M3</span>, 'jedzenie/produkty', true)}{nav('jedzenie', I.plan, 'Planer', <span className="tag soon food">M4</span>, 'jedzenie/planer', true)}</nav>
      <nav className="navgroup" aria-label="System"><h4>System</h4>{nav('zrodla', I.src, 'Źródła danych')}{nav('ustawienia', I.gear, 'Ustawienia')}</nav>
      <div className="side-foot"><button type="button" className="sync" title={collapsed ? `Google Health · ${lastOk ? `odświeżono ${whenOf(lastOk)}` : 'brak odczytu'}` : undefined} onClick={() => go('zrodla')}><span className={`dot ${syncBad ? 'warn' : ''}`} /><span>{sync.error ? 'Google Health · stan niedostępny' : `Google Health · ${lastOk ? `odświeżono ${whenOf(lastOk)}` : 'brak odczytu'}`}{syncBad && syncData?.last ? ' · błąd ostatniego odświeżenia' : ''}<br /><span className="faint">{syncData?.automatic ? `automatycznie co ${syncData.automatic} min` : sync.error ? 'zobacz Źródła danych' : 'odświeżanie ręczne'}</span></span></button></div>
    </aside>
    <div className="main">
      <header className="topbar"><h1>{titles[route.view]}</h1>{context}
        <div className="menuwrap"><button type="button" className="btn primary" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>{I.plus}<span className="hide-sm">Dodaj</span></button>
          {addOpen && <div className="menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAddOpen(false); go(route.view === 'dzien' ? location.hash.slice(1) || 'dzien' : 'dzien'); setDayTab('podsumowanie'); setTimeout(() => document.getElementById('usernote')?.focus(), 150); }}>Notatka do dnia</button>
            <button type="button" role="menuitem" disabled>Posiłek <span className="tag food">M3</span></button><button type="button" role="menuitem" disabled>Pomiar wagi <span className="tag">M7</span></button></div>}</div></header>
      <main className="content">{content}</main>
    </div>
    <nav className="bottomnav" aria-label="Nawigacja">{bottom('dzien', I.day, 'Dzień')}{bottom('tabela', I.table, 'Dni')}{bottom('trendy', I.trend, 'Trendy')}{bottom('jedzenie', I.food, 'Jedzenie')}{bottom('zrodla', I.more, 'Więcej')}</nav>
    {drawer && <Drawer state={drawer} onClose={() => setDrawer(null)} onOpenDay={openDay} />}
    <Tooltip />
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
