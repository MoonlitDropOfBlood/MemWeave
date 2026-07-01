import { readFileSync } from 'node:fs';

const file = process.argv[2];
const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
const types = {};
let found = false;

for (const line of lines) {
  try {
    const j = JSON.parse(line);
    types[j.type] = (types[j.type] || 0) + 1;

    const p = j.payload || {};
    const s = JSON.stringify(p);
    // Find assistant role with content
    if (s.includes('"role":"assistant"') && s.includes('content') && !found) {
      found = true;
      console.log('FOUND assistant in type:', j.type);
      const msgs = p.messages || p.response?.messages || [];
      const asst = msgs.find(m => m.role === 'assistant');
      if (asst) {
        console.log('  content type:', Array.isArray(asst.content) ? 'array' : typeof asst.content);
        console.log('  content sample:', JSON.stringify(asst.content).slice(0, 400));
      } else {
        console.log('  payload keys:', Object.keys(p).join(', '));
        console.log('  payload sample:', s.slice(0, 400));
      }
    }
  } catch {}
}

console.log('types:', JSON.stringify(types));