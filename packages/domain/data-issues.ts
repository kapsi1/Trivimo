export type Metric = 'weight' | 'body_fat' | 'steps' | 'distance' | 'total_energy' | 'active_energy';
export type IssueCode = 'basal_only' | 'incomparable_source' | 'incomplete_coverage' | 'unknown_origin' | 'identity_conflict' | 'invalid_value' | 'unknown_unit' | 'incomparable_day' | 'unresolved_overlap';
export interface DataIssue {
  metric: Metric;
  code: IssueCode;
  state: 'active' | 'resolved';
}

const labels: Record<Metric, string> = { weight: 'Masa ciała', body_fat: 'Tkanka tłuszczowa', steps: 'Kroki', distance: 'Dystans', total_energy: 'Kalorie', active_energy: 'Aktywne kalorie' };
const reasons: Record<IssueCode, string> = { basal_only: 'tylko energia bazowa', incomparable_source: 'nieporównywalne źródło', incomplete_coverage: 'niepełny zakres', unknown_origin: 'nieznane pochodzenie', identity_conflict: 'niejednoznaczne pomiary', invalid_value: 'nieprawidłowa wartość', unknown_unit: 'niepotwierdzona jednostka', incomparable_day: 'inny lub nieustalony dzień źródła', unresolved_overlap: 'nieuzgodnione nakładanie danych' };
const metricOrder: Metric[] = ['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy'];
const codeOrder: IssueCode[] = ['basal_only', 'incomparable_source', 'incomplete_coverage', 'unknown_origin', 'identity_conflict', 'invalid_value', 'unknown_unit', 'incomparable_day', 'unresolved_overlap'];

/** Notes are a deterministic view of active issues; user notes remain separate. */
export function projectIssueNotes(issues: readonly DataIssue[]): string[] {
  const active = new Set(issues.filter((issue) => issue.state === 'active').map((issue) => `${issue.metric}:${issue.code}`));
  return metricOrder.flatMap((metric) => codeOrder.filter((code) => active.has(`${metric}:${code}`)).map((code) => `${labels[metric]}: ${reasons[code]}`));
}
