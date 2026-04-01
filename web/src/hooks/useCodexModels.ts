import { useEffect, useState } from 'react';

import { api } from '../api/client';

interface CodexModelResponseItem {
  slug: string;
  displayName?: string;
}

interface CodexModelsResponse {
  models?: CodexModelResponseItem[];
}

interface CodexModelOption {
  value: string;
  label: string;
}

const DEFAULT_OPTION: CodexModelOption = {
  value: '__default__',
  label: '跟随系统默认值',
};

export function useCodexModels(enabled: boolean) {
  const [models, setModels] = useState<CodexModelOption[]>([DEFAULT_OPTION]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setModels([DEFAULT_OPTION]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void api
      .get<CodexModelsResponse>('/api/config/codex/models')
      .then((data) => {
        if (cancelled) return;
        const options = (data.models || []).map((model) => ({
          value: model.slug,
          label: model.displayName || model.slug,
        }));
        setModels([DEFAULT_OPTION, ...options]);
      })
      .catch(() => {
        if (cancelled) return;
        setModels([DEFAULT_OPTION]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { models, loading };
}
