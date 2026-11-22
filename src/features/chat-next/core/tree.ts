/**
 * Pure operations on a conversation's message tree. Inputs are never
 * mutated; every write returns a new array.
 */
import type { MessageNode } from "./types.js";

function byCreated(a: MessageNode, b: MessageNode): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function indexById(nodes: readonly MessageNode[]): Map<string, MessageNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** Children of `parentId` (`null` = roots), oldest first. */
export function childrenOf(nodes: readonly MessageNode[], parentId: string | null): MessageNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort(byCreated);
}

/** Root → leaf path. Returns [] for an unknown leaf; stops safely on cycles. */
export function pathTo(nodes: readonly MessageNode[], leafId: string | null): MessageNode[] {
  if (!leafId) return [];
  const index = indexById(nodes);
  const path: MessageNode[] = [];
  const seen = new Set<string>();
  let current = index.get(leafId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/** Follow the NEWEST child repeatedly from `fromId` down to a leaf. */
export function latestLeaf(nodes: readonly MessageNode[], fromId: string | null): string | null {
  let leaf = fromId;
  const seen = new Set<string>();
  for (;;) {
    const kids = childrenOf(nodes, leaf);
    const next = kids[kids.length - 1];
    if (!next || seen.has(next.id)) return leaf;
    seen.add(next.id);
    leaf = next.id;
  }
}

export interface SiblingInfo {
  index: number;
  total: number;
  ids: string[];
}

/** Position of a node among the nodes sharing its parent (for the ‹2/3› switcher). */
export function siblingsOf(nodes: readonly MessageNode[], id: string): SiblingInfo {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return { index: 0, total: 0, ids: [] };
  const ids = childrenOf(nodes, node.parentId).map((candidate) => candidate.id);
  return { index: ids.indexOf(id), total: ids.length, ids };
}

/**
 * Move to the previous/next sibling of `id` and return the new active leaf
 * (the newest leaf beneath that sibling). Returns `null` when out of range.
 */
export function switchSibling(
  nodes: readonly MessageNode[],
  id: string,
  delta: number,
): string | null {
  const { index, ids } = siblingsOf(nodes, id);
  const target = ids[index + delta];
  return target ? latestLeaf(nodes, target) : null;
}

/** Add a node; throws if its parent is unknown or the id is taken. */
export function appendNode(nodes: readonly MessageNode[], node: MessageNode): MessageNode[] {
  if (nodes.some((candidate) => candidate.id === node.id)) {
    throw new Error(`duplicate node id ${node.id}`);
  }
  if (node.parentId !== null && !nodes.some((candidate) => candidate.id === node.parentId)) {
    throw new Error(`unknown parent ${node.parentId}`);
  }
  return [...nodes, node];
}

/** Replace fields of one node (e.g. streaming deltas, status). */
export function updateNode(
  nodes: readonly MessageNode[],
  id: string,
  patch: Partial<Omit<MessageNode, "id" | "conversationId" | "parentId">>,
): MessageNode[] {
  return nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
}

/** All ids in the subtree rooted at `id` (inclusive). */
export function subtreeIds(nodes: readonly MessageNode[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Delete a node and everything under it. Returns the remaining nodes and a
 * sensible new active leaf (a surviving sibling branch, else the parent).
 */
export function removeSubtree(
  nodes: readonly MessageNode[],
  id: string,
): { nodes: MessageNode[]; activeLeafId: string | null } {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return { nodes: [...nodes], activeLeafId: null };
  const doomed = subtreeIds(nodes, id);
  const rest = nodes.filter((candidate) => !doomed.has(candidate.id));
  const sibling = childrenOf(rest, node.parentId).pop();
  return {
    nodes: rest,
    activeLeafId: sibling ? latestLeaf(rest, sibling.id) : node.parentId,
  };
}

/**
 * Copy the path root → `leafId` into a new conversation (fresh ids, linear).
 * `newId` must return unique ids.
 */
export function forkPath(
  nodes: readonly MessageNode[],
  leafId: string,
  conversationId: string,
  newId: () => string,
): MessageNode[] {
  let parentId: string | null = null;
  return pathTo(nodes, leafId).map((node) => {
    const copy: MessageNode = {
      ...node,
      id: newId(),
      conversationId,
      parentId,
      status: node.status === "streaming" ? "stopped" : node.status,
    };
    parentId = copy.id;
    return copy;
  });
}

/** Number of leaves = number of distinct branches in the tree. */
export function branchCount(nodes: readonly MessageNode[]): number {
  const parents = new Set(nodes.map((node) => node.parentId));
  return nodes.filter((node) => !parents.has(node.id)).length;
}
