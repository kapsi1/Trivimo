import { createApp } from './app.ts';
import { createDemoDatabase } from '../../packages/storage/days.ts';

createApp(createDemoDatabase()).listen(3000, '127.0.0.1', () => {
  console.log('Syntetyczne API: http://127.0.0.1:3000');
});
