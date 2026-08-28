"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps one failed asset from taking down the scene.
 *
 * Placed inside the canvas, so both `children` and `fallback` are 3D nodes.
 */
export class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Office prop failed to load", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
