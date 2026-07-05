import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Reactive store for the currently selected file path.
 *
 * Uses Lit's ReactiveController pattern so any component that adopts the
 * controller re-renders automatically when the path changes. The store
 * is instantiated per-mount in WorkspacePage, so navigation away/back
 * clears the state (no stale selection leaks).
 */
export class SelectionStore {
  private _path: string | null = null;
  private listeners = new Set<ReactiveControllerHost>();

  get path(): string | null {
    return this._path;
  }

  set(path: string | null): void {
    if (this._path === path) return;
    this._path = path;
    this.listeners.forEach(host => host.requestUpdate());
  }

  /**
   * Return a ReactiveController that, when adopted by a host component,
   * subscribes the host to store changes. The host will re-render
   * automatically when `set()` is called.
   */
  controller(host: ReactiveControllerHost): ReactiveController {
    const listeners = this.listeners;
    return {
      host,
      hostConnected(): void {
        listeners.add(host);
      },
      hostDisconnected(): void {
        listeners.delete(host);
      },
    };
  }
}
