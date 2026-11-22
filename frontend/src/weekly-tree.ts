export type WeeklyNode<T> = { row: T; children: WeeklyNode<T>[] };

// Keep sibling order; optional context rows group siblings without adding commitments.
export function groupWeeklyRows<T extends { item: { id: string; parent: string | null } }>(
  rows: T[],
  contextRows: T[] = [],
): WeeklyNode<T>[] {
  const visibleIds = new Set(rows.map((row) => row.item.id));
  const childCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.item.parent) childCounts.set(row.item.parent, (childCounts.get(row.item.parent) || 0) + 1);
  }
  const context = contextRows.filter((row) => !visibleIds.has(row.item.id) && (childCounts.get(row.item.id) || 0) > 1);
  // Insert each contextual parent at its first child's position.
  const missing = new Map(context.map((row) => [row.item.id, row]));
  const groupedRows: T[] = [];
  for (const row of rows) {
    const parent = row.item.parent && missing.get(row.item.parent);
    if (parent) { groupedRows.push(parent); missing.delete(parent.item.id); }
    groupedRows.push(row);
  }
  const nodes = new Map(groupedRows.map((row) => [row.item.id, { row, children: [] } as WeeklyNode<T>]));
  const roots: WeeklyNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.row.item.parent ? nodes.get(node.row.item.parent) : undefined;
    const ancestors = new Set([node.row.item.id]);
    let ancestor = parent;
    while (ancestor && !ancestors.has(ancestor.row.item.id)) {
      ancestors.add(ancestor.row.item.id);
      ancestor = ancestor.row.item.parent ? nodes.get(ancestor.row.item.parent) : undefined;
    }
    // Malformed cycles must never hide rows or recurse forever.
    if (parent && !ancestor) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// Projects already shown in a day need no undated heading; keep their children.
export function omitWeeklyProjects<T extends { item: { id: string; kind: string } }>(
  nodes: WeeklyNode<T>[],
  datedProjectIds: ReadonlySet<string>,
): WeeklyNode<T>[] {
  return nodes.flatMap((node) => {
    const children = omitWeeklyProjects(node.children, datedProjectIds);
    return node.row.item.kind === "project" && datedProjectIds.has(node.row.item.id)
      ? children
      : [{ ...node, children }];
  });

}
