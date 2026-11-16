// Builds the GitHub stats and top-languages cards for the profile README.
// Usage: GITHUB_TOKEN=... node scripts/stats-cards.mjs <user> <out-dir>
// No dependencies: Node 20+ (global fetch).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [user = process.env.GITHUB_REPOSITORY_OWNER, outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !token) {
  console.error("Usage: GITHUB_TOKEN=... node scripts/stats-cards.mjs <user> <out-dir>");
  process.exit(1);
}

const theme = {
  bg: "#0D0D0D",
  title: "#FF5F1F",
  icon: "#E63946",
  text: "#FFFFFF",
  muted: "#AAAAAA",
  track: "#333333",
};
const font = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";
const LANG_COUNT = 6;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

async function fetchData() {
  const query = `
    query($login: String!, $after: String) {
      user(login: $login) {
        name
        contributionsCollection { totalCommitContributions restrictedContributionsCount }
        pullRequests { totalCount }
        issues { totalCount }
        repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]) { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`;
  let after = null;
  let user0 = null;
  const repos = [];
  do {
    const { user: u } = await gql(query, { login: user, after });
    user0 ??= u;
    repos.push(...u.repositories.nodes);
    after = u.repositories.pageInfo.hasNextPage ? u.repositories.pageInfo.endCursor : null;
  } while (after);
  return { ...user0, repos };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

function card({ width, height, title, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <style>
    .title { font: 600 18px ${font}; fill: ${theme.title}; }
    .label { font: 600 14px ${font}; fill: ${theme.text}; }
    .value { font: 700 14px ${font}; fill: ${theme.text}; }
    .lang { font: 400 11px ${font}; fill: ${theme.text}; }
  </style>
  <rect width="${width}" height="${height}" rx="4.5" fill="${theme.bg}"/>
  <text x="25" y="35" class="title">${esc(title)}</text>
  ${body}
</svg>
`;
}

// Small monochrome icons (24x24 grid) drawn in the icon colour.
const icons = {
  star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z",
  commit: "M12 8a4 4 0 100 8 4 4 0 000-8zm-10 3h5.1a5 5 0 019.8 0H22v2h-5.1a5 5 0 01-9.8 0H2z",
  pr: "M6 3a3 3 0 011 5.8v6.4A3 3 0 116 21a3 3 0 01-1-5.8V8.8A3 3 0 016 3zm12 12.2V9a2 2 0 00-2-2h-2v3l-4-4 4-4v3h2a4 4 0 014 4v6.2a3 3 0 11-2 0z",
  issue: "M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v7h-2zm0 9h2v2h-2z",
  repo: "M5 3h13a1 1 0 011 1v15a1 1 0 01-1 1h-4v-2h3v-3H6a1 1 0 000 2h1v2H6a3 3 0 01-3-3V5a2 2 0 012-2zm1 2v8h11V5zm3 12h3v5l-1.5-1-1.5 1z",
};

function statsCard(d) {
  const year = new Date().getUTCFullYear();
  const stars = d.repos.reduce((n, r) => n + r.stargazerCount, 0);
  const commits = d.contributionsCollection.totalCommitContributions + d.contributionsCollection.restrictedContributionsCount;
  const rows = [
    ["star", "Total stars earned", stars],
    ["commit", `Total commits (${year})`, commits],
    ["pr", "Total PRs", d.pullRequests.totalCount],
    ["issue", "Total issues", d.issues.totalCount],
    ["repo", "Contributed to (last year)", d.repositoriesContributedTo.totalCount],
  ];
  const body = rows
    .map(([icon, label, value], i) => {
      const y = 55 + i * 25;
      return `<g transform="translate(25 ${y})">
    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="${theme.icon}" d="${icons[icon]}"/></svg>
    <text x="25" y="12.5" class="label">${esc(label)}:</text>
    <text x="230" y="12.5" class="value">${fmt(value)}</text>
  </g>`;
    })
    .join("\n  ");
  const name = d.name || user;
  return card({ width: 400, height: 195, title: `${name}'s GitHub stats`, body });
}

function langsCard(d) {
  const totals = new Map();
  for (const r of d.repos)
    for (const { size, node } of r.languages.edges) {
      const t = totals.get(node.name) ?? { size: 0, color: node.color || "#858585" };
      t.size += size;
      totals.set(node.name, t);
    }
  const top = [...totals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, LANG_COUNT);
  const sum = top.reduce((n, [, t]) => n + t.size, 0) || 1;
  const width = 300;
  const barWidth = width - 50;

  let x = 0;
  const segments = top
    .map(([, t]) => {
      const w = (t.size / sum) * barWidth;
      const rect = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${t.color}"/>`;
      x += w;
      return rect;
    })
    .join("");
  const bar = `<mask id="bar"><rect width="${barWidth}" height="8" rx="5" fill="#fff"/></mask>
  <g transform="translate(25 55)"><rect width="${barWidth}" height="8" rx="5" fill="${theme.track}"/><g mask="url(#bar)">${segments}</g></g>`;

  const items = top
    .map(([name, t], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const pct = ((t.size / sum) * 100).toFixed(2);
      return `<g transform="translate(${25 + col * 135} ${80 + row * 25})">
    <circle cx="5" cy="6" r="5" fill="${t.color}"/>
    <text x="15" y="10" class="lang">${esc(name)} ${pct}%</text>
  </g>`;
    })
    .join("\n  ");
  const rows = Math.ceil(top.length / 2);
  const height = Math.max(110, 90 + rows * 25);
  return card({ width, height, title: "Most used languages", body: `${bar}\n  ${items}` });
}

const data = await fetchData();
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "stats.svg"), statsCard(data));
await writeFile(join(outDir, "top-langs.svg"), langsCard(data));
console.log(`Wrote stats.svg and top-langs.svg to ${outDir}`);
