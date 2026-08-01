import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { addCloudAccount, getProject, scanProject } from "@/lib/projects.functions";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Github } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Architecture map — Latchgraph" },
      { name: "description", content: "Explore the knowledge graph and architecture diagram for this system." },
      { property: "og:title", content: "Architecture map — Latchgraph" },
      { property: "og:description", content: "Layered architecture diagram derived from your repository and cloud environments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchProject = useServerFn(getProject);
  const scan = useServerFn(scanProject);
  const addCloud = useServerFn(addCloudAccount);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cloudLabel, setCloudLabel] = useState("");
  const [cloudRegion, setCloudRegion] = useState("");
  const [cloudProvider, setCloudProvider] = useState<"aws" | "gcp" | "azure" | "other">("aws");

  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject({ data: { projectId } }),
  });

  const rescan = useMutation({
    mutationFn: () => scan({ data: { projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Graph refreshed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Rescan failed"),
  });

  const linkCloud = useMutation({
    mutationFn: () =>
      addCloud({
        data: {
          projectId,
          provider: cloudProvider,
          label: cloudLabel.trim(),
          region: cloudRegion.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      setCloudLabel("");
      setCloudRegion("");
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Environment attached — rescan to fold it into the graph");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not attach environment"),
  });

  const nodes = query.data?.nodes ?? [];
  const edges = query.data?.edges ?? [];
  const selected = useMemo(() => nodes.find((n) => n.node_key === selectedKey) ?? null, [nodes, selectedKey]);
  const related = useMemo(
    () =>
      edges
        .filter((e) => e.source_key === selectedKey || e.target_key === selectedKey)
        .map((e) => {
          const otherKey = e.source_key === selectedKey ? e.target_key : e.source_key;
          const other = nodes.find((n) => n.node_key === otherKey);
          return {
            direction: e.source_key === selectedKey ? "out" : "in",
            kind: e.kind,
            label: other?.label ?? otherKey,
            key: otherKey,
          };
        }),
    [edges, nodes, selectedKey],
  );

  const details = (selected?.details ?? {}) as Record<string, unknown>;

  return (
    <main className="mx-auto max-w-6xl px-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard">
            <ArrowLeft className="mr-1 size-4" /> All systems
          </Link>
        </Button>
        <Button variant="outline" size="sm" disabled={rescan.isPending} onClick={() => rescan.mutate()}>
          <RefreshCw className="mr-2 size-4" />
          {rescan.isPending ? "Rescanning…" : "Rescan"}
        </Button>
      </header>

      {query.isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : query.isError ? (
        <p className="panel p-7 text-sm text-muted-foreground">
          {query.error instanceof Error ? query.error.message : "Could not load this system."}
        </p>
      ) : (
        <>
          <section className="panel p-7">
            <p className="label-mono">System</p>
            <h1 className="mt-3 text-3xl font-semibold">{query.data?.project.name}</h1>
            <a
              href={query.data?.project.repo_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              <Github className="size-3.5" aria-hidden />
              {query.data?.project.repo_url.replace("https://github.com/", "")}
            </a>
            {query.data?.project.summary && (
              <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {query.data.project.summary}
              </p>
            )}
            {query.data?.project.status === "failed" && (
              <p className="mt-4 font-mono text-xs text-destructive">{query.data.project.status_detail}</p>
            )}
            <div className="mt-6 flex gap-8 font-mono text-xs text-muted-foreground">
              <span>{nodes.length} components</span>
              <span>{edges.length} relationships</span>
              <span>branch {query.data?.project.default_branch ?? "—"}</span>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="panel p-5">
              <p className="label-mono mb-4">Architecture diagram</p>
              {nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No components yet. Run a scan to build the graph.</p>
              ) : (
                <ArchitectureDiagram
                  nodes={nodes}
                  edges={edges}
                  selectedKey={selectedKey}
                  onSelect={(key) => setSelectedKey(key === selectedKey ? null : key)}
                />
              )}
            </div>

            <aside className="panel p-6">
              <p className="label-mono">Component detail</p>
              {selected ? (
                <div className="mt-4 space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold">{selected.label}</h2>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {selected.kind} · {selected.layer}
                    </p>
                    {selected.path && (
                      <p className="mt-2 font-mono text-xs break-all text-muted-foreground">{selected.path}</p>
                    )}
                  </div>

                  {Array.isArray(details["languages"]) && (details["languages"] as string[]).length > 0 && (
                    <div>
                      <p className="label-mono">Languages</p>
                      <p className="mt-1 text-sm">{(details["languages"] as string[]).join(", ")}</p>
                    </div>
                  )}

                  {Array.isArray(details["packages"]) && (
                    <div>
                      <p className="label-mono">Evidence: packages</p>
                      <ul className="mt-1 space-y-1 font-mono text-xs text-muted-foreground">
                        {(details["packages"] as string[]).map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(details["evidence"]) && (
                    <div>
                      <p className="label-mono">Evidence: files</p>
                      <ul className="mt-1 space-y-1 font-mono text-xs break-all text-muted-foreground">
                        {(details["evidence"] as string[]).map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(details["sample_files"]) && (
                    <div>
                      <p className="label-mono">Files inside</p>
                      <ul className="mt-1 space-y-1 font-mono text-xs break-all text-muted-foreground">
                        {(details["sample_files"] as string[]).map((p) => (
                          <li key={p}>
                            <a
                              href={`${query.data?.project.repo_url}/blob/${query.data?.project.default_branch ?? "main"}/${p}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hover:text-foreground"
                            >
                              {p}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="label-mono">Connections</p>
                    {related.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">No recorded relationships.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {related.map((r) => (
                          <li key={`${r.direction}-${r.key}-${r.kind}`}>
                            <button
                              type="button"
                              onClick={() => setSelectedKey(r.key)}
                              className="w-full text-left text-sm hover:text-primary"
                            >
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {r.direction === "out" ? "→" : "←"} {r.kind}
                              </span>{" "}
                              {r.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Select any box in the diagram to inspect its files, packages, and connections.
                </p>
              )}
            </aside>
          </section>

          <section className="mt-8 panel p-7">
            <p className="label-mono">Cloud environments</p>
            <h2 className="mt-3 text-xl font-semibold">Attach the environments this system runs in</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Environments appear as the top layer of the diagram. No credentials are stored — you register the
              environment, and the next scan folds it into the graph.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              {(query.data?.cloudAccounts ?? []).map((account) => (
                <span
                  key={account.id}
                  className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
                >
                  {account.provider.toUpperCase()} · {account.label}
                  {account.region ? ` · ${account.region}` : ""}
                </span>
              ))}
              {(query.data?.cloudAccounts ?? []).length === 0 && (
                <span className="font-mono text-xs text-muted-foreground">None attached yet</span>
              )}
            </div>

            <form
              className="mt-6 grid gap-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (!cloudLabel.trim()) {
                  toast.error("Give the environment a name");
                  return;
                }
                linkCloud.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select value={cloudProvider} onValueChange={(v) => setCloudProvider(v as typeof cloudProvider)}>
                  <SelectTrigger id="provider" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">AWS</SelectItem>
                    <SelectItem value="gcp">GCP</SelectItem>
                    <SelectItem value="azure">Azure</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-label">Environment</Label>
                <Input
                  id="cloud-label"
                  value={cloudLabel}
                  maxLength={80}
                  placeholder="production"
                  onChange={(e) => setCloudLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-region">Region</Label>
                <Input
                  id="cloud-region"
                  value={cloudRegion}
                  maxLength={40}
                  placeholder="eu-west-1"
                  onChange={(e) => setCloudRegion(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={linkCloud.isPending}>
                Attach
              </Button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
