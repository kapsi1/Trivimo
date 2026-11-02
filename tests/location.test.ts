import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { takeoutDatabasePath } from '../packages/storage/location.ts';

test('lokalizacja bazy jest spójna w normalnym i przekierowanym środowisku', () => {
  const profile = 'C:\\Users\\Example';
  const local = join(profile, 'AppData', 'Local');
  const expected = join(local, 'Trivimo', 'takeout-raw.sqlite');
  assert.equal(takeoutDatabasePath({ LOCALAPPDATA: local, USERPROFILE: profile }), expected);
  assert.equal(takeoutDatabasePath({ LOCALAPPDATA: join(local, 'Packages', 'sandbox.{1234}', 'AC'), USERPROFILE: profile }), expected);
  assert.equal(takeoutDatabasePath({ TRIVIMO_DATA_DIR: 'D:\\Custom', LOCALAPPDATA: local }), join('D:\\Custom', 'takeout-raw.sqlite'));
  assert.equal(takeoutDatabasePath({}), null);
});
