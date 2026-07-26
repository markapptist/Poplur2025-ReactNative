import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const app = readFileSync(join(root, 'App.tsx'), 'utf8');
const screenDir = join(root, 'src/screens');
const files = readdirSync(screenDir)
  .filter(file => /Screen\.(tsx|ts)$/.test(file))
  .sort();

const rows = files.map(file => {
  const name = file.replace(/\.(tsx|ts)$/, '');
  const source = readFileSync(join(screenDir, file), 'utf8');
  const referenced = app.includes(name);
  const webView = /\bWebView\b/.test(source);
  const list = /\b(FlatList|SectionList|ScrollView)\b/.test(source);
  const images = (source.match(/\bImage\b/g) ?? []).length;
  return { screen: name, reachableFromApp: referenced, webView, list, imageRefs: images };
});

console.table(rows);
const unreachable = rows.filter(row => !row.reachableFromApp);
if (unreachable.length) {
  console.warn(`\\n${unreachable.length} screen file(s) are not referenced by App.tsx.`);
}
