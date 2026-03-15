import { create } from 'zustand';
import { api } from '../api/client';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'project';
  enabled: boolean;
  syncedFromHost?: boolean;
  packageName?: string;
  installedAt?: string;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
}

export interface SkillDetail extends Skill {
  content: string;
}

interface SkillsState {
  skills: Skill[];
  loading: boolean;
  error: string | null;

  loadSkills: () => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  getSkillDetail: (id: string) => Promise<SkillDetail>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,

  loadSkills: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ skills: Skill[] }>('/api/skills');
      set({ skills: data.skills, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  toggleSkill: async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/api/skills/${id}`, { enabled });
      set({ error: null });
      await get().loadSkills();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  deleteSkill: async (id: string) => {
    try {
      await api.delete(`/api/skills/${id}`);
      set({ error: null });
      await get().loadSkills();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  getSkillDetail: async (id: string) => {
    const data = await api.get<{ skill: SkillDetail }>(`/api/skills/${id}`);
    return data.skill;
  },
}));
