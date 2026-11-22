import { describe, expect, it } from "vitest";
import {
  appendNode,
  branchCount,
  childrenOf,
  forkPath,
  latestLeaf,
  pathTo,
  removeSubtree,
  siblingsOf,
  subtreeIds,
  switchSibling,
  updateNode,
} from "./tree.js";
import type { MessageNode, Role } from "./types.js";

let clock = 0;
function node(id: string, parentId: string | null, role: Role = "user", content = id): MessageNode {
  clock += 1;
  return { id, conversationId: "c1", parentId, role, content, createdAt: clock, status: "ok" };
}

/**
 * u1 ─ a1 ─ u2 ─ a2
 *    └ a1b ─ u3
 */
function sample(): MessageNode[] {
  clock = 0;
  return [
    node("u1", null),
    node("a1", "u1", "assistant"),
    node("u2", "a1"),
    node("a2", "u2", "assistant"),
    node("a1b", "u1", "assistant"),
    node("u3", "a1b"),
  ];
}

describe("chat-next tree", () => {
  it("returns children oldest first", () => {
    expect(childrenOf(sample(), "u1").map((n) => n.id)).toEqual(["a1", "a1b"]);
    expect(childrenOf(sample(), null).map((n) => n.id)).toEqual(["u1"]);
  });

  it("builds the root → leaf path", () => {
    expect(pathTo(sample(), "a2").map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(pathTo(sample(), "u3").map((n) => n.id)).toEqual(["u1", "a1b", "u3"]);
    expect(pathTo(sample(), "missing")).toEqual([]);
    expect(pathTo(sample(), null)).toEqual([]);
  });

  it("does not loop forever on a corrupted cycle", () => {
    const nodes = [node("x", "y"), node("y", "x")];
    expect(pathTo(nodes, "x").length).toBe(2);
  });

  it("follows the newest child to a leaf", () => {
    expect(latestLeaf(sample(), "u1")).toBe("u3");
    expect(latestLeaf(sample(), "a1")).toBe("a2");
    expect(latestLeaf(sample(), "a2")).toBe("a2");
  });

  it("reports sibling position for the switcher", () => {
    expect(siblingsOf(sample(), "a1b")).toEqual({ index: 1, total: 2, ids: ["a1", "a1b"] });
    expect(siblingsOf(sample(), "u1")).toEqual({ index: 0, total: 1, ids: ["u1"] });
    expect(siblingsOf(sample(), "nope").total).toBe(0);
  });

  it("switches branches and lands on that branch's newest leaf", () => {
    expect(switchSibling(sample(), "a1", 1)).toBe("u3");
    expect(switchSibling(sample(), "a1b", -1)).toBe("a2");
    expect(switchSibling(sample(), "a1", -1)).toBeNull();
    expect(switchSibling(sample(), "a1b", 1)).toBeNull();
  });

  it("appends without mutating and validates parents and ids", () => {
    const nodes = sample();
    const next = appendNode(nodes, node("a3", "u3", "assistant"));
    expect(next).toHaveLength(nodes.length + 1);
    expect(nodes).toHaveLength(6);
    expect(() => appendNode(nodes, node("zz", "ghost"))).toThrow(/unknown parent/);
    expect(() => appendNode(nodes, node("u1", null))).toThrow(/duplicate/);
  });

  it("updates one node immutably", () => {
    const nodes = sample();
    const next = updateNode(nodes, "a2", { content: "edited", status: "stopped" });
    expect(next.find((n) => n.id === "a2")).toMatchObject({ content: "edited", status: "stopped" });
    expect(nodes.find((n) => n.id === "a2")?.content).toBe("a2");
  });

  it("collects and removes a subtree, picking a surviving branch", () => {
    expect([...subtreeIds(sample(), "a1")].sort()).toEqual(["a1", "a2", "u2"]);
    const removed = removeSubtree(sample(), "a1b");
    expect(removed.nodes.map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(removed.activeLeafId).toBe("a2");
    const all = removeSubtree(sample(), "u1");
    expect(all.nodes).toEqual([]);
    expect(all.activeLeafId).toBeNull();
  });

  it("forks a path into a new linear conversation", () => {
    let n = 0;
    const forked = forkPath(
      updateNode(sample(), "u3", { status: "streaming" }),
      "u3",
      "c2",
      () => `f${++n}`,
    );
    expect(forked.map((f) => [f.id, f.parentId, f.content])).toEqual([
      ["f1", null, "u1"],
      ["f2", "f1", "a1b"],
      ["f3", "f2", "u3"],
    ]);
    expect(forked.every((f) => f.conversationId === "c2")).toBe(true);
    expect(forked[2]?.status).toBe("stopped");
  });

  it("counts branches as leaves", () => {
    expect(branchCount(sample())).toBe(2);
    expect(branchCount([])).toBe(0);
  });
});
