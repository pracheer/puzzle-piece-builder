import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  repoUrl: z.string().trim().min(3, "Repository URL is required").max(300),
});

const ProjectIdInput = z.object({ projectId: z.string().uuid() });

const CloudAccountInput = z.object({
  projectId: z.string().uuid(),
  provider: z.enum(["aws", "gcp", "azure", "other"]),
  label: z.string().trim().min(1).max(80),
  region: z.string().trim().max(40).optional(),
});

const NOT_FOUND = "Project not found";

async function assertProjectOwnership(
  supabase: { from: (table: "projects") => any },
  projectId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(NOT_FOUND);
  if (!data) throw new Error(NOT_FOUND);
  return data as { id: string; user_id: string };
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, repo_url, status, node_count, edge_count, last_scan_at, created_at, summary")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertProjectOwnership(context.supabase, data.projectId, context.userId);

    const [project, nodes, edges, clouds] = await Promise.all([
      context.supabase
        .from("projects")
        .select("*")
        .eq("id", data.projectId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("graph_nodes")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("user_id", context.userId)
        .order("weight", { ascending: false }),
      context.supabase
        .from("graph_edges")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("user_id", context.userId),
      context.supabase
        .from("cloud_accounts")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("user_id", context.userId),
    ]);
    if (project.error) throw new Error(project.error.message);
    if (!project.data) throw new Error(NOT_FOUND);
    return {
      project: project.data,
      nodes: nodes.data ?? [],
      edges: edges.data ?? [],
      cloudAccounts: clouds.data ?? [],
    };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateProjectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { parseRepoUrl } = await import("./graph.server");
    const ref = parseRepoUrl(data.repoUrl);
    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        name: data.name || ref.repo,
        repo_url: `https://github.com/${ref.owner}/${ref.repo}`,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { projectId: project.id };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertProjectOwnership(context.supabase, data.projectId, context.userId);
    const { error } = await context.supabase
      .from("projects")
      .delete()
      .eq("id", data.projectId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addCloudAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CloudAccountInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertProjectOwnership(context.supabase, data.projectId, context.userId);
    const { error } = await context.supabase.from("cloud_accounts").insert({
      project_id: data.projectId,
      user_id: context.userId,
      provider: data.provider,
      label: data.label,
      region: data.region ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const scanProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { parseRepoUrl, buildGraphFromRepo, enrichWithAi } = await import("./graph.server");
    const supabase = context.supabase;

    const { data: project, error: loadError } = await supabase
      .from("projects")
      .select("id, repo_url, user_id")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(NOT_FOUND);
    if (!project || project.user_id !== context.userId) throw new Error(NOT_FOUND);

    await supabase
      .from("projects")
      .update({ status: "scanning", status_detail: "Fetching repository structure", updated_at: new Date().toISOString() })
      .eq("id", project.id)
      .eq("user_id", context.userId);

    try {
      const graph = await buildGraphFromRepo(parseRepoUrl(project.repo_url));

      const { data: clouds } = await supabase
        .from("cloud_accounts")
        .select("id, provider, label, region")
        .eq("project_id", project.id);

      for (const account of clouds ?? []) {
        graph.nodes.push({
          node_key: `cloud-account:${account.id}`,
          label: account.label,
          kind: `${account.provider.toUpperCase()} environment`,
          layer: "cloud",
          path: null,
          weight: 3,
          details: { provider: account.provider, region: account.region },
        });
        graph.edges.push({
          source_key: graph.nodes[0]!.node_key,
          target_key: `cloud-account:${account.id}`,
          kind: "runs_on",
        });
      }

      const ai = await enrichWithAi(graph);
      const keys = new Set(graph.nodes.map((n) => n.node_key));
      for (const edge of ai.edges) {
        if (!keys.has(edge.source_key) || !keys.has(edge.target_key)) continue;
        if (graph.edges.some((e) => e.source_key === edge.source_key && e.target_key === edge.target_key)) continue;
        graph.edges.push(edge);
      }

      await supabase.from("graph_edges").delete().eq("project_id", project.id);
      await supabase.from("graph_nodes").delete().eq("project_id", project.id);

      const { error: nodeError } = await supabase.from("graph_nodes").insert(
        graph.nodes.map((n) => ({
          project_id: project.id,
          user_id: context.userId,
          node_key: n.node_key,
          label: n.label,
          kind: n.kind,
          layer: n.layer,
          path: n.path,
          weight: n.weight,
          details: n.details as never,
        })),
      );
      if (nodeError) throw new Error(nodeError.message);

      if (graph.edges.length) {
        const { error: edgeError } = await supabase.from("graph_edges").insert(
          graph.edges.map((e) => ({
            project_id: project.id,
            user_id: context.userId,
            source_key: e.source_key,
            target_key: e.target_key,
            kind: e.kind,
          })),
        );
        if (edgeError) throw new Error(edgeError.message);
      }

      await supabase
        .from("projects")
        .update({
          status: "ready",
          status_detail: null,
          default_branch: graph.meta.default_branch,
          summary: ai.summary || graph.meta.description,
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
          last_scan_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);

      return { nodes: graph.nodes.length, edges: graph.edges.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan failed";
      await supabase
        .from("projects")
        .update({ status: "failed", status_detail: message, updated_at: new Date().toISOString() })
        .eq("id", project.id);
      throw new Error(message);
    }
  });
