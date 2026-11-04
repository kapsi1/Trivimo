import { useState } from 'react';

/** Scope of a future stage with its label; not a design, so it makes no promise beyond the plan. */
export function Placeholder({ title, text, list, stage }: { title: string; text: string; list?: string[]; stage: string }) {
  return <div className="empty"><span className={`tag ${stage.startsWith('M3') || stage.startsWith('M4') ? 'food' : ''}`}>Etap {stage} · jeszcze nie zaprojektowane</span><h3>{title}</h3><p>{text}</p>{list && <ul>{list.map((item) => <li key={item}>{item}</li>)}</ul>}</div>;
}

export function WorkoutsView() {
  return <Placeholder title="Treningi" stage="M2" text="Lista sesji z filtrem sportu, źródła i zakresu oraz szczegóły treningu: przebieg tętna, strefy, tempo, przerwy i mapa trasy." list={['Lista sesji (paginowana)', 'Szczegóły sesji z osią czasu i mapą', 'Intensywność: poziomy aktywności, strefy HR i AZM osobno']} />;
}

type FoodTab = 'dziennik' | 'produkty' | 'planer' | 'importy';
export function FoodView({ initial }: { initial?: FoodTab }) {
  const [tab, setTab] = useState<FoodTab>(initial ?? 'dziennik');
  const tabs: [FoodTab, string, string][] = [['dziennik', 'Dziennik', 'M3'], ['produkty', 'Produkty i przepisy', 'M3'], ['planer', 'Planer', 'M4'], ['importy', 'Importy', 'M3–M4']];
  const body = {
    dziennik: <Placeholder title="Dziennik posiłków" stage="M3" text="Posiłki dnia, szybkie dodawanie i korekta, suma dnia z oznaczeniem wpisów niepełnych. Ten sam formularz posłuży na telefonie." />,
    produkty: <Placeholder title="Produkty i przepisy" stage="M3" text="Własny katalog produktów z wersjami etykiet, przepisy ze składnikami i porcjami, wyszukiwanie z porównaniem źródeł." />,
    planer: <Placeholder title="Planer posiłków" stage="M4" text="Plan dni i posiłków osobno od dziennika; „Zjadłem” tworzy wpis dziennika bez duplikatów." />,
    importy: <Placeholder title="Importy jedzenia" stage="M3–M4" text="Obecny arkusz posiłków, Open Food Facts i FatSecret. Każde źródło z pochodzeniem i licencją." />,
  }[tab];
  return <><div className="tabs" role="tablist" aria-label="Jedzenie">{tabs.map(([key, label, stage]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => setTab(key)}>{label} <span className="tag food">{stage}</span></button>)}</div>{body}</>;
}
