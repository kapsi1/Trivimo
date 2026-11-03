import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectIssueNotes, type DataIssue } from '../packages/domain/data-issues.ts';

test('uwagi są deterministyczne, bez duplikatów i bez rozwiązanych przyczyn', () => {
  const basal: DataIssue = { metric: 'total_energy', code: 'basal_only', state: 'active' };
  const identity: DataIssue = { metric: 'weight', code: 'identity_conflict', state: 'active' };
  const resolved: DataIssue = { metric: 'active_energy', code: 'incomparable_source', state: 'resolved' };
  const expected = ['Masa ciała: niejednoznaczne pomiary', 'Kalorie: tylko energia bazowa'];
  assert.deepEqual(projectIssueNotes([basal, identity, basal, resolved]), expected);
  assert.deepEqual(projectIssueNotes([resolved, identity, basal]), expected);
  assert.deepEqual(projectIssueNotes([{ ...basal, state: 'resolved' }, identity]), [expected[0]]);
});
