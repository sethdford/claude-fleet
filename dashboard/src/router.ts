/**
 * Hash-based Client Router
 * Extracted from app.js — handles route registration, parameterized matching, and cleanup.
 */

type RouteHandler = (...params: string[]) => Promise<(() => void) | void>;
type NavigationCallback = (hash: string) => void;

export class Router {
  private routes = new Map<string, RouteHandler>();
  private currentCleanup: (() => void) | null = null;
  private onNavigate: NavigationCallback | null = null;

  /** Register a route handler. */
  register(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  /** Set callback invoked after each navigation (used to update nav highlight). */
  setOnNavigate(callback: NavigationCallback): void {
    this.onNavigate = callback;
  }

  /** Navigate to a hash route. */
  navigate(path: string): void {
    window.location.hash = path;
  }

  /** Resolve the current hash to a handler and execute it. */
  async handleRoute(): Promise<void> {
    const hash = window.location.hash.slice(1) || '/';
    const [path, ...params] = hash.split('/').filter(Boolean);
    const routePath = '/' + path;

    let handler = this.routes.get(routePath);
    let routeParams = params;

    // Check for parameterized routes (e.g. /worker/:handle)
    if (!handler) {
      for (const [route, h] of this.routes) {
        const routeParts = route.split('/').filter(Boolean);
        const hashParts = hash.slice(1).split('/').filter(Boolean);

        if (routeParts.length === hashParts.length) {
          let isMatch = true;
          const extractedParams: string[] = [];

          for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
              extractedParams.push(hashParts[i]);
            } else if (routeParts[i] !== hashParts[i]) {
              isMatch = false;
              break;
            }
          }

          if (isMatch) {
            handler = h;
            routeParams = extractedParams;
            break;
          }
        }
      }
    }

    // Cleanup previous view
    if (this.currentCleanup) {
      this.currentCleanup();
      this.currentCleanup = null;
    }

    // Default to overview if no route matches
    if (!handler) {
      handler = this.routes.get('/');
    }

    if (handler) {
      this.onNavigate?.(hash);
      const cleanup = await handler(...routeParams);
      if (typeof cleanup === 'function') {
        this.currentCleanup = cleanup;
      }
    }
  }

  /** Start listening for hash changes. */
  init(): void {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  }
}

const router = new Router();
export default router;
