import type { ReactNode } from "react";

/**
 * Grid view of a hierarchical list (chart of accounts, warehouse locations —
 * design-system §12.19): every top-level node becomes ONE grouped card that
 * contains its whole subtree, drawn by the page's own `renderNode`, so the
 * parent / child relationship, expand-collapse, selection and row actions are the
 * tree's own. Nothing is flattened into per-record cards.
 */
export function TreeGridCards<T extends { id: string }>({
  nodes,
  renderNode,
}: {
  nodes: T[];
  renderNode: (node: T) => ReactNode;
}) {
  return (
    <div data-record-grid="wide" className="-m-2">
      {nodes.map((node) => (
        <section
          key={node.id}
          data-record-card=""
          data-static=""
          data-tone="neutral"
          className="min-w-0 p-1"
        >
          {renderNode(node)}
        </section>
      ))}
    </div>
  );
}
