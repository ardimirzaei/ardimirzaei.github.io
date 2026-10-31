// Fetches Google Scholar author stats through SerpApi and writes data/scholar.json.
// Usage:  SERPAPI_KEY=... node scripts/update-scholar.mjs      (Node 18+)
// On any failure the existing data/scholar.json is left untouched and the script exits non-zero.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const featuredPath = path.join(root, 'data', 'featured.json');
const outPath = path.join(root, 'data', 'scholar.json');

const key = process.env.SERPAPI_KEY;
if (!key) {
  console.error('SERPAPI_KEY is not set. Add it as a repository secret (Settings > Secrets and variables > Actions).');
  process.exit(1);
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const featured = JSON.parse(await readFile(featuredPath, 'utf8'));
let previous = { articles: [] };
try { previous = JSON.parse(await readFile(outPath, 'utf8')); } catch { /* first run */ }

const url = new URL('https://serpapi.com/search.json');
url.search = new URLSearchParams({
  engine: 'google_scholar_author',
  author_id: featured.author_id,
  hl: 'en',
  num: '100',
  sort: 'pubdate',
  api_key: key
});

const res = await fetch(url);
if (!res.ok) {
  console.error(`SerpApi responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const body = await res.json();
if (body.error || !Array.isArray(body.articles)) {
  console.error('Unexpected SerpApi response:', body.error || Object.keys(body));
  process.exit(1);
}

const table = body.cited_by?.table ?? [];
const pick = (name) => table.find((row) => row[name])?.[name]?.all;
const citations = pick('citations');
const h_index = pick('h_index');
const i10_index = pick('i10_index');
if (![citations, h_index, i10_index].every(Number.isFinite)) {
  console.error('Could not read citation metrics from the response; keeping existing data.');
  process.exit(1);
}

const articles = body.articles.map((a) => ({
  title: a.title,
  year: a.year ? Number(a.year) : null,
  cites: a.cited_by?.value ?? 0,
  link: a.link ?? null
}));

const papers = {};
for (const [id, start] of Object.entries(featured.papers)) {
  const hits = articles.filter((a) => norm(a.title).startsWith(norm(start)));
  if (!hits.length) {
    console.warn(`No Scholar entry matches "${id}" (${start}). Check data/featured.json.`);
    // Keep the previous value so the page does not lose a number.
    if (previous.papers?.[id]) papers[id] = previous.papers[id];
    continue;
  }
  const best = hits.sort((a, b) => b.cites - a.cites)[0];
  papers[id] = { cites: best.cites, link: best.link };
}

const knownBefore = new Set((previous.articles ?? []).map((a) => norm(a.title)));
const added = articles.filter((a) => knownBefore.size && !knownBefore.has(norm(a.title)));
added.forEach((a) => console.log(`New on Scholar: ${a.title} (${a.year ?? 'n.d.'})`));

const out = {
  asOf: new Date().toISOString().slice(0, 10),
  source: 'Google Scholar via SerpApi',
  citations, h_index, i10_index,
  papers,
  articles: articles.map(({ title, year, cites }) => ({ title, year, cites }))
};
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${path.relative(root, outPath)}: ${citations} citations, h-index ${h_index}, i10 ${i10_index}, ${articles.length} entries.`);
