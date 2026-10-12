declare module 'react' {
  const React: {
    createElement: (type: any, props?: any, ...children: any[]) => any,
    Fragment: any,
    StrictMode: any,
  };
  export default React;
  export { React };
  export const Fragment: any;
  export const StrictMode: any;
  export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export interface FormEvent<T = any> { preventDefault(): void; target: T; }
  export interface ChangeEvent<T = any> { target: T; }
  export interface MouseEvent<T = any> { preventDefault(): void; stopPropagation(): void; target: T; }
  // Error Boundary 支持
  export class Component<P = any, S = any> {
    constructor(props?: P);
    state: S;
    setState(state: Partial<S> | ((prevState: S) => Partial<S>)): void;
    readonly props: P & { children?: any };
    context: any;
    refs: any;
    forceUpdate(callback?: () => void): void;
    render(): any;
  }
  export interface ErrorInfo { componentStack: string | null; }
  export type ReactNode = any;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'react-dom/client' {
  export function createRoot(container: any): { render(element: any): void; unmount(): void };
}

declare module 'socket.io-client' {
  export interface Socket {
    on(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, data?: any): void;
    disconnect(): void;
  }
  export function io(url: string, options?: any): Socket;
}

declare module 'zustand' {
  interface Store<T> {
    getState(): T;
    setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
    subscribe(listener: (state: T) => void): () => void;
  }
  interface UseStore<T> extends Function {
    (): T;
    getState: () => T;
    setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
    subscribe: (listener: (state: T) => void) => () => void;
  }
  function create<T>(initializer: (set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void, get: () => T) => T): UseStore<T>;
  export { create };
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
