import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, GitBranch, Cloud, Network, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Latchgraph — Map your codebase into an architecture diagram" },
      {
        name: "description",
        content:
          "Point Latchgraph at a GitHub repo and cloud environment. It builds a knowledge graph of your system and renders a navigable architecture diagram.",
      },
      { property: "og:title", content: "Latchgraph — Map your codebase into an architecture diagram" },
      {
        property: "og:description",
        content:
          "Point Latchgraph at a GitHub repo and cloud environment. It builds a knowledge graph of your system and renders a navigable architecture diagram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    icon: GitBranch,
    title: "Ingest the repo",
    body: "Give it a GitHub URL. Latchgraph walks the file tree, manifests, and CI config to find real components.",
  },
  {
    icon: Cloud,
    title: "Attach environments",
    body: "Register the cloud environments a project runs in so infrastructure appears in the same picture.",
  },
  {
    icon: Network,
    title: "Tie it together",
    body: "Relationships between modules, services, and data stores are inferred and stored as a knowledge graph.",
  },
  {
    icon: Boxes,
    title: "Navigate the diagram",
    body: "A layered architecture diagram: click any component to see files, packages, and what it connects to.",
  },
];

function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <span className="font-mono text-sm tracking-[0.3em] uppercase">Latchgraph</span>
        <Button asChild variant="outline" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="pt-16 pb-20">
        <p className="label-mono">Codebase intelligence</p>
        <h1 className="mt-4 max-w-3xl text-5xl leading-[1.05] font-semibold md:text-6xl">
          Understand any system as a diagram, not a directory listing.
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground">
          Latchgraph ingests your repositories and cloud environments, builds one knowledge graph across
          them, and renders it as an architecture diagram you can dive into.
        </p>
        <div className="mt-9 flex items-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">
              Map a repository <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <span className="font-mono text-xs text-muted-foreground">Works with any public GitHub repo</span>
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
        {STEPS.map((step) => (
          <article key={step.title} className="bg-surface p-7">
            <step.icon className="size-5 text-primary" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          </article>
        ))}
      </section>

      <section className="mt-20 panel p-8">
        <p className="label-mono">What you get</p>
        <div className="mt-6 grid gap-8 font-mono text-xs sm:grid-cols-5">
          {[
            ["Cloud", "var(--layer-cloud)"],
            ["Build & deploy", "var(--layer-infra)"],
            ["Application", "var(--layer-app)"],
            ["Services", "var(--layer-service)"],
            ["Data", "var(--layer-data)"],
          ].map(([label, color]) => (
            <div key={label}>
              <div className="h-1 w-full rounded" style={{ background: color }} />
              <p className="mt-3 text-muted-foreground uppercase tracking-widest">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          Every scan produces a layered map of your system, from the cloud environment down to the data stores,
          with the evidence behind each component kept one click away.
        </p>
      </section>
    </main>
  );
}
