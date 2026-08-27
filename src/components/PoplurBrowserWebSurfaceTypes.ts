export type PoplurBrowserNavigationState = {
  url: string;
  canGoBack: boolean;
  loading: boolean;
  failed: boolean;
};

export type PoplurBrowserWebSurfaceHandle = {
  goBack: () => void;
  stopLoading: () => void;
};

export type PoplurBrowserWebSurfaceProps = {
  url: string;
  onNavigationStateChange: (state: PoplurBrowserNavigationState) => void;
};
