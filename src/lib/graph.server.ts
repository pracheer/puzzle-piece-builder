// Server-only helpers: fetch a GitHub repository and derive a knowledge graph.
export type GraphNode = {
  node_key: string;
  label: string;
  kind: string;
  layer: "cloud" | "service" | "application" | "data" | "infrastructure";
  path: string | null;
  weight: number;
  details: Record<string, unknown>;
};

export type GraphEdge = {
  source_key: string;
  target_key: string;
  kind: string;
};

export type RepoRef = { owner: string; repo: string };

export function parseRepoUrl(input: string): RepoRef {
  const cleaned = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
  if (!match) {
    const short = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (short) return { owner: short[1]!, repo: short[2]! };
    throw new Error("Enter a GitHub repository URL, e.g. https://github.com/owner/repo");
  }
  return { owner: match[1]!, repo: match[2]! };
}

const GH = "https://api.github.com";

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "jigsaw-architecture-mapper",
  };
  const token = process.env["GITHUB_TOKEN"];
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${GH}${path}`, { headers: ghHeaders() });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) throw new Error("Repository not found, or it is private and not reachable.");
    if (res.status === 403) throw new Error("GitHub rate limit reached. Try again in a few minutes.");
    throw new Error(`GitHub request failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type RepoMeta = {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
};

type TreeEntry = { path: string; type: string; size?: number };

const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  cs: "C#",
  php: "PHP",
  swift: "Swift",
  sql: "SQL",
  sh: "Shell",
};

const DEP_SERVICES: Array<{ match: RegExp; label: string; kind: string; layer: GraphNode["layer"] }> = [
  { match: /^(pg|postgres|psycopg2?|sqlalchemy|prisma|drizzle-orm)/, label: "PostgreSQL", kind: "database", layer: "data" },
  { match: /^(mysql|mysql2)/, label: "MySQL", kind: "database", layer: "data" },
  { match: /^(mongodb|mongoose)/, label: "MongoDB", kind: "database", layer: "data" },
  { match: /^(redis|ioredis)/, label: "Redis", kind: "cache", layer: "data" },
  { match: /^(@supabase\/)/, label: "Supabase", kind: "backend platform", layer: "service" },
  { match: /^(firebase|firebase-admin)/, label: "Firebase", kind: "backend platform", layer: "service" },
  { match: /^(aws-sdk|@aws-sdk|boto3)/, label: "AWS", kind: "cloud SDK", layer: "cloud" },
  { match: /^(@google-cloud|google-cloud)/, label: "Google Cloud", kind: "cloud SDK", layer: "cloud" },
  { match: /^(@azure)/, label: "Azure", kind: "cloud SDK", layer: "cloud" },
  { match: /^(stripe)/, label: "Stripe", kind: "payments", layer: "service" },
  { match: /^(openai|anthropic|@ai-sdk|langchain)/, label: "AI provider", kind: "AI API", layer: "service" },
  { match: /^(kafkajs|kafka-python|amqplib|celery|bullmq)/, label: "Message queue", kind: "queue", layer: "service" },
  { match: /^(elasticsearch|@elastic|opensearch)/, label: "Search index", kind: "search", layer: "data" },
  { match: /^(react|vue|svelte|next|@angular\/core)/, label: "Web frontend", kind: "ui runtime", layer: "application" },
  { match: /^(express|fastify|koa|nestjs|@nestjs|flask|django|fastapi|gin-gonic)/, label: "API server", kind: "http server", layer: "application" },
];

const INFRA_RULES: Array<{ match: RegExp; label: string; kind: string }> = [
  { match: /(^|\/)dockerfile$/i, label: "Docker image", kind: "container" },
  { match: /docker-compose\.ya?ml$/i, label: "Docker Compose", kind: "container orchestration" },
  { match: /\.tf$/i, label: "Terraform", kind: "infrastructure as code" },
  { match: /^\.github\/workflows\//i, label: "GitHub Actions", kind: "CI/CD" },
  { match: /(^|\/)(k8s|kubernetes|charts|helm)\//i, label: "Kubernetes", kind: "orchestration" },
  { match: /serverless\.ya?ml$/i, label: "Serverless Framework", kind: "deployment" },
  { match: /(^|\/)(vercel|netlify)\.json$/i, label: "Edge hosting", kind: "deployment" },
  { match: /(^|\/)supabase\/(migrations|config)/i, label: "Managed Postgres migrations", kind: "database schema" },
];

const IGNORED_DIRS = /^(node_modules|dist|build|\.git|vendor|target|\.next|coverage|__pycache__)$/;

async function fetchTextFile(ref: RepoRef, branch: string, path: string): Promise<string | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${path}`,
    { headers: { "User-Agent": "jigsaw-architecture-mapper" } },
  );
  if (!res.ok) return null;
  return await res.text();
}

function collectDeps(files: Record<string, string | null>): string[] {
  const deps = new Set<string>();
  const pkg = files["package.json"];
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).forEach((d) => deps.add(d));
    } catch {
      /* ignore malformed manifest */
    }
  }
  for (const name of ["requirements.txt", "go.mod", "Gemfile", "pyproject.toml"]) {
    const raw = files[name];
    if (!raw) continue;
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => {
        const token = line.split(/[\s=<>~!;"']/)[0];
        if (token) deps.add(token.replace(/^require\s+/, ""));
      });
  }
  return [...deps];
}

export type BuiltGraph = {
  meta: RepoMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  languages: string[];
  deps: string[];
};

export async function buildGraphFromRepo(ref: RepoRef): Promise<BuiltGraph> {
  const meta = await gh<RepoMeta>(`/repos/${ref.owner}/${ref.repo}`);
  const tree = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${meta.default_branch}?recursive=1`,
  );

  const files = tree.tree.filter((e) => e.type === "blob").map((e) => ({ ...e }));
  const manifestNames = ["package.json", "requirements.txt", "go.mod", "Gemfile", "pyproject.toml"];
  const manifests: Record<string, string | null> = {};
  await Promise.all(
    manifestNames
      .filter((name) => files.some((f) => f.path === name))
      .map(async (name) => {
        manifests[name] = await fetchTextFile(ref, meta.default_branch, name);
      }),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const pushNode = (node: GraphNode) => {
    if (seen.has(node.node_key)) return;
    seen.add(node.node_key);
    nodes.push(node);
  };
  const pushEdge = (edge: GraphEdge) => {
    if (edges.some((e) => e.source_key === edge.source_key && e.target_key === edge.target_key)) return;
    edges.push(edge);
  };

  const rootKey = `repo:${meta.full_name}`;
  const langCount = new Map<string, number>();
  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = LANG_BY_EXT[ext];
    if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
  }
  const languages = [...langCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

  pushNode({
    node_key: rootKey,
    label: meta.name,
    kind: "repository",
    layer: "application",
    path: null,
    weight: files.length,
    details: {
      description: meta.description,
      branch: meta.default_branch,
      files: files.length,
      languages: languages.slice(0, 5),
      stars: meta.stargazers_count,
    },
  });

  // Modules = top level directories (plus a root-files bucket).
  type ModuleInfo = { files: number; langs: Map<string, number>; sample: string[] };
  const modules = new Map<string, ModuleInfo>();
  for (const file of files) {
    const segments = file.path.split("/");
    const top = segments.length > 1 ? segments[0]! : "(root files)";
    if (IGNORED_DIRS.test(top)) continue;
    const entry: ModuleInfo = modules.get(top) ?? { files: 0, langs: new Map<string, number>(), sample: [] };
    entry.files += 1;
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = LANG_BY_EXT[ext];
    if (lang) entry.langs.set(lang, (entry.langs.get(lang) ?? 0) + 1);
    if (entry.sample.length < 8) entry.sample.push(file.path);
    modules.set(top, entry);
  }

  for (const [name, info] of [...modules.entries()].sort((a, b) => b[1].files - a[1].files).slice(0, 24)) {
    const key = `module:${name}`;
    pushNode({
      node_key: key,
      label: name,
      kind: name.startsWith(".") ? "config" : "module",
      layer: "application",
      path: name === "(root files)" ? null : name,
      weight: info.files,
      details: {
        files: info.files,
        languages: [...info.langs.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l).slice(0, 3),
        sample_files: info.sample,
      },
    });
    pushEdge({ source_key: rootKey, target_key: key, kind: "contains" });
  }

  // Infrastructure signals.
  for (const rule of INFRA_RULES) {
    const matches = files.filter((f) => rule.match.test(f.path)).map((f) => f.path);
    if (!matches.length) continue;
    const key = `infra:${rule.label}`;
    pushNode({
      node_key: key,
      label: rule.label,
      kind: rule.kind,
      layer: "infrastructure",
      path: matches[0] ?? null,
      weight: matches.length,
      details: { evidence: matches.slice(0, 6), file_count: matches.length },
    });
    pushEdge({ source_key: rootKey, target_key: key, kind: "deployed_by" });
  }

  // External services / data stores inferred from manifests.
  const deps = collectDeps(manifests);
  for (const rule of DEP_SERVICES) {
    const hits = deps.filter((d) => rule.match.test(d));
    if (!hits.length) continue;
    const key = `${rule.layer}:${rule.label}`;
    pushNode({
      node_key: key,
      label: rule.label,
      kind: rule.kind,
      layer: rule.layer,
      path: null,
      weight: hits.length,
      details: { packages: hits.slice(0, 8) },
    });
    pushEdge({ source_key: rootKey, target_key: key, kind: "uses" });
  }

  return { meta, nodes, edges, languages, deps };
}

type AiEnrichment = {
  summary: string;
  edges: GraphEdge[];
};

export async function enrichWithAi(graph: BuiltGraph): Promise<AiEnrichment> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { summary: "", edges: [] };

  const payload = {
    repository: graph.meta.full_name,
    description: graph.meta.description,
    languages: graph.languages.slice(0, 6),
    components: graph.nodes.map((n) => ({
      key: n.node_key,
      label: n.label,
      kind: n.kind,
      layer: n.layer,
      files: n.weight,
      sample: (n.details as { sample_files?: string[] }).sample_files?.slice(0, 5),
    })),
    dependencies: graph.deps.slice(0, 80),
  };

  const prompt = [
    "You are a software architect. Given a repository's components, infer how they relate.",
    "Return STRICT JSON only, no markdown, matching:",
    '{"summary": string, "relationships": [{"source": string, "target": string, "kind": string}]}',
    "- summary: 3-5 sentences explaining the system architecture for a new engineer.",
    "- relationships: up to 20 edges between EXISTING component keys, excluding pairs that only repeat containment.",
    "- kind is one of: calls, depends_on, reads_from, writes_to, deploys, configures, renders.",
    "",
    JSON.stringify(payload),
  ].join("\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[ai] enrichment failed [${res.status}]: ${body.slice(0, 400)}`);
    if (res.status === 429) throw new Error("AI rate limit reached. Please retry in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue analysing repositories.");
    return { summary: "", edges: [] };
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as {
      summary?: string;
      relationships?: Array<{ source?: string; target?: string; kind?: string }>;
    };
    const validKeys = new Set(graph.nodes.map((n) => n.node_key));
    const edges: GraphEdge[] = (parsed.relationships ?? [])
      .filter((r) => r.source && r.target && validKeys.has(r.source) && validKeys.has(r.target) && r.source !== r.target)
      .slice(0, 24)
      .map((r) => ({ source_key: r.source!, target_key: r.target!, kind: r.kind ?? "depends_on" }));
    return { summary: parsed.summary ?? "", edges };
  } catch {
    return { summary: "", edges: [] };
  }
}
