import { create } from 'zustand';
import { api } from '../api/client';

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUSD: number;
  totalMessages: number;
  totalActiveDays: number;
}

export interface UsageBreakdown {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  message_count: number;
}

interface UsageState {
  summary: UsageSummary | null;
  breakdown: UsageBreakdown[];
  days: number;
  loading: boolean;
  error: string | null;
  loadStats: (days?: number) => Promise<void>;
  setDays: (days: number) => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  breakdown: [],
  days: 7,
  loading: false,
  error: null,

  loadStats: async (days?: number) => {
    const d = days ?? get().days;
    set({ loading: true, days: d });
    try {
      const data = await api.get<{
        summary: UsageSummary;
        breakdown: UsageBreakdown[];
        days: number;
      }>(`/api/usage/stats?days=${d}`);
      set({ summary: data.summary, breakdown: data.breakdown, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  setDays: (days: number) => {
    set({ days });
    get().loadStats(days);
  },
}));
