import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createProject, deleteProject, listProjects, scanProject } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Trash2, RefreshCw, ArrowUpRight, Github } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your systems — Latchgraph" },
      { name: "description", content: "Repositories and cloud environments mapped into architecture diagrams." },
      { property: "og:title", content: "Your systems — Latchgraph" },
      { property: "og:description", content: "Manage the repositories Latchgraph has mapped for you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

const STATUS_COPY: Record<string, string> = {
  pending: "Not scanned yet",
  scanning: "Scanning…",
  ready: "Mapped",
  failed: "Scan failed",
};

function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchProjects = useServerFn(listProjects);
  const create = useServerFn(createProject);
  const scan = useServerFn(scanProject);
  const remove = useServerFn(deleteProject);

  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => fetchProjects() });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { projectId } = await create({ data: { name: name || repoUrl.split("/").pop() || "Untitled", repoUrl } });
      await scan({ data: { projectId } });
      return projectId;
    },
    onSuccess: async (projectId) => {
      setName("");
      setRepoUrl("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Repository mapped");
      navigate({ to: "/projects/$projectId", params: { projectId } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not map that repository"),
  });

  const rescanMutation = useMutation({
    mutationFn: (projectId: string) => scan({ data: { projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Graph refreshed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Rescan failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => remove({ data: { projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link to="/" className="font-mono text-sm tracking-[0.3em] uppercase">
          Latchgraph
        </Link>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <section className="panel mt-6 p-7">
        <p className="label-mono">New system</p>
        <h1 className="mt-3 text-2xl font-semibold">Map a repository</h1>
        <form
          className="mt-6 grid gap-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!repoUrl.trim()) {
              toast.error("Add a GitHub repository URL");
              return;
            }
            createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">System name</Label>
            <Input
              id="name"
              value={name}
              maxLength={80}
              placeholder="Payments platform"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo">GitHub repository</Label>
            <Input
              id="repo"
              value={repoUrl}
              maxLength={300}
              placeholder="https://github.com/owner/repo"
              onChange={(e) => setRepoUrl(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Analysing…" : "Build graph"}
          </Button>
        </form>
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          Public repositories work out of the box. Cloud environments are attached per system.
        </p>
      </section>

      <section className="mt-12">
        <p className="label-mono">Mapped systems</p>
        <div className="mt-4 space-y-3">
          {projects.isLoading &&
            [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}

          {projects.data?.length === 0 && !projects.isLoading && (
            <p className="panel p-7 text-sm text-muted-foreground">
              Nothing mapped yet. Paste a repository URL above to build your first architecture diagram.
            </p>
          )}

          {projects.data?.map((project) => (
            <article key={project.id} className="panel flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="truncate text-lg font-semibold">{project.name}</h2>
                  <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
                    {STATUS_COPY[project.status] ?? project.status}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <Github className="size-3.5" aria-hidden />
                  {project.repo_url.replace("https://github.com/", "")}
                </p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {project.node_count} components · {project.edge_count} relationships
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rescan"
                  disabled={rescanMutation.isPending}
                  onClick={() => rescanMutation.mutate(project.id)}
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete project"
                  onClick={() => deleteMutation.mutate(project.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                    Open <ArrowUpRight className="ml-1 size-3.5" />
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
