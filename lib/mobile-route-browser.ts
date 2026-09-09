import type { JobRouteOption } from './api';

export const MOBILE_ROUTE_PAGE_SIZE = 50;

export type MobileRouteBrowserState = {
  search: string;
  offset: number;
  routes: JobRouteOption[];
  hasMore: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  requestId: number;
};

export const emptyMobileRouteBrowser: MobileRouteBrowserState = {
  search: '', offset: 0, routes: [], hasMore: false, status: 'idle', requestId: 0,
};

type Action =
  | { type: 'reset'; requestId: number }
  | { type: 'request'; search: string; offset: number; requestId: number }
  | { type: 'loaded'; routes: JobRouteOption[]; hasMore: boolean; requestId: number }
  | { type: 'failed'; requestId: number };

export function mobileRouteBrowserReducer(state: MobileRouteBrowserState, action: Action): MobileRouteBrowserState {
  if (action.requestId < state.requestId) return state;
  if (action.type === 'reset') return { ...emptyMobileRouteBrowser, requestId: action.requestId };
  if (action.type === 'request') {
    return { search: action.search, offset: action.offset, requestId: action.requestId, routes: [], hasMore: false, status: 'loading' };
  }
  if (action.requestId !== state.requestId) return state;
  if (action.type === 'failed') return { ...state, status: 'error' };
  return { ...state, routes: action.routes.slice(0, MOBILE_ROUTE_PAGE_SIZE), hasMore: action.hasMore, status: 'ready' };
}
