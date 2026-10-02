import { Component, type ReactNode } from "react";

/**
 * One piece of the page that can't render (say, a malformed event in the log) is left out instead of taking the
 * whole editor down. Since the log is replayed on every load, a whole-page error would come back on every reload.
 */
export class Safe extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("Left out a part of the page that could not render", e);
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/** A stable key per object: a new object (a new form, a new question) gets a new key, the same one keeps its key. */
const keys = new WeakMap<object, number>();
let next = 0;
export const keyOf = (o: object) => {
  if (!keys.has(o)) keys.set(o, ++next);
  return keys.get(o)!;
};
