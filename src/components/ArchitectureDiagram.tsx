import { useMemo } from "react";

export type DiagramNode = {
  id: string;
  node_key: string;
  label: string;
  kind: string;
  layer: string;
  weight: number;
};

export type DiagramEdge = {
  source_key: string;
  target_key: string;
  kind: string;
};

const LAYER_ORDER = ["cloud", "infrastructure", "application", "service", "data"] as const;

const LAYER_TITLE: Record<string, string> = {
  cloud: "Cloud environments",
  infrastructure: "Build & deploy",
  application: "Application code",
  service: "Platform services",
  data: "Data stores",
};

const LAYER_STROKE: Record<string, string> = {
  cloud: "var(--layer-cloud)",
  infrastructure: "var(--layer-infra)",
  application: "var(--layer-app)",
  service: "var(--layer-service)",
  data: "var(--layer-data)",
};

const NODE_W = 168;
const NODE_H = 54;
const GAP_X = 26;
const ROW_H = 132;
const PAD = 28;

export function ArchitectureDiagram({
  nodes,
  edges,
  selectedKey,
  onSelect,
}: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const layout = useMemo(() => {
    const rows = LAYER_ORDER.map((layer) => ({
      layer,
      items: nodes.filter((n) => n.layer === layer),
    })).filter((row) => row.items.length > 0);

    const maxPerRow = Math.max(1, ...rows.map((r) => r.items.length));
    const width = Math.max(720, PAD * 2 + maxPerRow * NODE_W + (maxPerRow - 1) * GAP_X);
    const positions = new Map<string, { x: number; y: number }>();

    rows.forEach((row, rowIndex) => {
      const rowWidth = row.items.length * NODE_W + (row.items.length - 1) * GAP_X;
      const startX = (width - rowWidth) / 2;
      row.items.forEach((item, i) => {
        positions.set(item.node_key, {
          x: startX + i * (NODE_W + GAP_X),
          y: PAD + 34 + rowIndex * ROW_H,
        });
      });
    });

    return {
      rows,
      positions,
      width,
      height: PAD * 2 + 34 + rows.length * ROW_H,
    };
  }, [nodes, edges]);

  const connected = useMemo(() => {
    if (!selectedKey) return null;
    const set = new Set<string>([selectedKey]);
    edges.forEach((e) => {
      if (e.source_key === selectedKey) set.add(e.target_key);
      if (e.target_key === selectedKey) set.add(e.source_key);
    });
    return set;
  }, [selectedKey, edges]);

  return (
    <div className="overflow-auto rounded-lg border border-border bg-background/40">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-w-full"
        role="img"
        aria-label="System architecture diagram"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>

        {layout.rows.map((row, i) => (
          <g key={row.layer}>
            <line
              x1={0}
              x2={layout.width}
              y1={PAD + i * ROW_H}
              y2={PAD + i * ROW_H}
              stroke="var(--border)"
              strokeDasharray="3 6"
            />
            <text
              x={12}
              y={PAD + i * ROW_H + 18}
              fill="var(--muted-foreground)"
              fontSize="10"
              letterSpacing="2"
              fontFamily="var(--font-mono)"
            >
              {(LAYER_TITLE[row.layer] ?? row.layer).toUpperCase()}
            </text>
          </g>
        ))}

        {edges.map((edge, i) => {
          const from = layout.positions.get(edge.source_key);
          const to = layout.positions.get(edge.target_key);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const mid = (y1 + y2) / 2;
          const dim = connected ? !(connected.has(edge.source_key) && connected.has(edge.target_key)) : false;
          return (
            <path
              key={`${edge.source_key}-${edge.target_key}-${i}`}
              d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`}
              fill="none"
              stroke={dim ? "var(--border)" : "var(--muted-foreground)"}
              strokeWidth={dim ? 1 : 1.4}
              opacity={dim ? 0.4 : 0.9}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {nodes.map((node) => {
          const pos = layout.positions.get(node.node_key);
          if (!pos) return null;
          const active = selectedKey === node.node_key;
          const dim = connected ? !connected.has(node.node_key) : false;
          return (
            <g
              key={node.node_key}
              transform={`translate(${pos.x},${pos.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(node.node_key)}
              opacity={dim ? 0.35 : 1}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--card)"
                stroke={active ? LAYER_STROKE[node.layer] : "var(--border)"}
                strokeWidth={active ? 2 : 1}
              />
              <rect width={3} height={NODE_H} rx={2} fill={LAYER_STROKE[node.layer] ?? "var(--border)"} />
              <text x={14} y={22} fill="var(--foreground)" fontSize="12.5" fontWeight="600">
                {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
              </text>
              <text x={14} y={39} fill="var(--muted-foreground)" fontSize="10" fontFamily="var(--font-mono)">
                {node.kind.length > 24 ? `${node.kind.slice(0, 23)}…` : node.kind}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
