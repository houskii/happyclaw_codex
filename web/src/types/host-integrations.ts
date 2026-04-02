export interface HostIntegrationConflictCandidate {
  sourceId: string;
  sourceLabel: string;
  sourcePath: string;
}

export interface HostIntegrationConflictItem {
  itemId: string;
  mode: 'auto' | 'pinned';
  pinnedSourceId: string | null;
  effectiveSourceId: string | null;
  effectiveSourceLabel: string | null;
  effectiveSourcePath: string | null;
  warning: string | null;
  candidates: HostIntegrationConflictCandidate[];
}
