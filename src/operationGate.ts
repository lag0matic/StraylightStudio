export type Operation = {
  readonly kind: 'prepare' | 'capture' | 'preview';
  cancelled: boolean;
  workPending: boolean;
  stopPending: boolean;
  stopConfirmed: boolean;
  readonly settled: Promise<void>;
  settle: () => void;
};

// A cancelled operation owns the equipment until both work and stop have settled.
export class OperationGate {
  current: Operation | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.current?.kind ?? null;
  private notify() { this.listeners.forEach((listener) => listener()); }

  begin(kind: Operation['kind']): Operation | null {
    if (this.current) return null;
    let settle = () => {};
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    this.current = { kind, cancelled: false, workPending: true, stopPending: false, stopConfirmed: false, settled, settle };
    this.notify();
    return this.current;
  }

  requestStop(operation: Operation): boolean {
    if (this.current !== operation || operation.stopPending) return false;
    operation.cancelled = true;
    operation.stopPending = true;
    operation.stopConfirmed = false;
    return true;
  }

  finishWork(operation: Operation) {
    operation.workPending = false;
    operation.settle();
    this.release(operation);
  }

  requireStop(operation: Operation) {
    if (this.current === operation) {
      operation.cancelled = true;
      operation.stopConfirmed = false;
    }
  }

  finishStop(operation: Operation, confirmed: boolean) {
    operation.stopPending = false;
    operation.stopConfirmed = confirmed;
    this.release(operation);
  }

  private release(operation: Operation) {
    if (this.current === operation && !operation.workPending && !operation.stopPending
      && (!operation.cancelled || operation.stopConfirmed)) {
      this.current = null;
      this.notify();
    }
  }
}
