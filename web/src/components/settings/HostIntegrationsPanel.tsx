import { useMemo, useState } from 'react';
import { FolderSearch, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useHostIntegrationsStore } from '@/stores/host-integrations';
import type {
  HostIntegrationProvider,
  HostIntegrationSource,
  HostIntegrationSourceStatus,
} from './types';
import { getErrorMessage } from './types';

interface HostIntegrationsSummaryProps {
  isAdmin: boolean;
  onSynced?: () => Promise<void> | void;
}

interface ProviderHostIntegrationCardProps {
  isAdmin: boolean;
  provider: HostIntegrationProvider;
}

interface CustomHostIntegrationsPanelProps {
  isAdmin: boolean;
}

function formatSyncTime(value: string | null): string {
  if (!value) return '未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未同步';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function getStatusTone(status: HostIntegrationSourceStatus['status']): string {
  switch (status) {
    case 'ok':
      return 'bg-success-bg text-success border-success/20';
    case 'missing':
      return 'bg-warning/10 text-warning border-warning/20';
    case 'unreadable':
    case 'invalid':
      return 'bg-error/10 text-error border-error/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function cloneSources(sources: HostIntegrationSourceStatus[]): HostIntegrationSource[] {
  return sources.map(({ status: _status, message: _message, ...source }) => ({ ...source }));
}

function ProviderBadge({ provider }: { provider: HostIntegrationProvider }) {
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {provider === 'anthropic' ? 'Anthropic 默认来源' : 'OpenAI 默认来源'}
    </span>
  );
}

function SourceToggles({
  source,
  isAdmin,
  onChange,
}: {
  source: HostIntegrationSource;
  isAdmin: boolean;
  onChange: (updater: (current: HostIntegrationSource) => HostIntegrationSource) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <Label htmlFor={`${source.id}-enabled`} className="text-sm">
          整体启用
        </Label>
        <Switch
          id={`${source.id}-enabled`}
          checked={source.enabled}
          disabled={!isAdmin}
          onCheckedChange={(checked) => onChange((current) => ({ ...current, enabled: checked }))}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <Label htmlFor={`${source.id}-skills`} className="text-sm">
          Skills 接入
        </Label>
        <Switch
          id={`${source.id}-skills`}
          checked={source.skillsEnabled}
          disabled={!isAdmin}
          onCheckedChange={(checked) => onChange((current) => ({ ...current, skillsEnabled: checked }))}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <Label htmlFor={`${source.id}-mcp`} className="text-sm">
          MCP 接入
        </Label>
        <Switch
          id={`${source.id}-mcp`}
          checked={source.mcpEnabled}
          disabled={!isAdmin}
          onCheckedChange={(checked) => onChange((current) => ({ ...current, mcpEnabled: checked }))}
        />
      </div>
    </div>
  );
}

function SourcePath({
  source,
  isAdmin,
  editable = false,
  onChange,
}: {
  source: HostIntegrationSource;
  isAdmin: boolean;
  editable?: boolean;
  onChange?: (nextPath: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">来源路径</div>
      {editable && isAdmin && onChange ? (
        <div className="max-w-2xl">
          <Input
            value={source.path}
            className="font-mono text-xs"
            onChange={(e) => onChange(e.target.value)}
            placeholder="输入自定义来源路径"
          />
        </div>
      ) : (
        <div className="max-w-2xl rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-foreground">
          {source.path}
        </div>
      )}
    </div>
  );
}

function SourceStatusHint({ source }: { source: HostIntegrationSourceStatus }) {
  return (
    <>
      {source.message && <div className="text-xs text-muted-foreground">{source.message}</div>}
      <div className="text-xs text-muted-foreground">
        {!source.enabled
          ? '当前来源已整体停用；同步时不会接入 Skills 或 MCP。'
          : `当前配置：Skills ${source.skillsEnabled ? '启用' : '禁用'} · MCP ${source.mcpEnabled ? '启用' : '禁用'}`}
      </div>
    </>
  );
}

export function HostIntegrationsSummary({ isAdmin, onSynced }: HostIntegrationsSummaryProps) {
  const { skills, mcp, load, sync, syncing } = useHostIntegrationsStore();

  const handleReload = async () => {
    await load();
  };

  const handleSync = async () => {
    try {
      const result = await sync();
      await onSynced?.();
      toast.success(
        `同步完成：Skills 新增 ${result.skills.stats.added} / 更新 ${result.skills.stats.updated}，MCP 新增 ${result.mcp.stats.added} / 更新 ${result.mcp.stats.updated}`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, '同步宿主来源失败'));
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold">宿主来源总览</div>
            <div className="mt-1 text-sm text-muted-foreground">
              默认 provider 来源分别绑定 `~/.claude` 与 `~/.codex`。你也可以在底部添加自定义来源，
              并分别控制它们是否向 Skills 与 MCP 暴露内容。
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              Skills 最近同步：{formatSyncTime(skills.lastSyncAt)} · {skills.syncedCount} 项
            </div>
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              MCP 最近同步：{formatSyncTime(mcp.lastSyncAt)} · {mcp.syncedCount} 项
            </div>
            <Button variant="outline" onClick={handleReload}>
              <RefreshCw size={16} />
              刷新来源
            </Button>
            {isAdmin && (
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                <FolderSearch size={16} className={syncing ? 'animate-pulse' : ''} />
                {syncing ? '同步中...' : '立即同步'}
              </Button>
            )}
          </div>
        </div>

        {!isAdmin && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            仅管理员可修改项目级宿主来源；你仍然可以在这里查看当前来源路径与同步状态。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProviderHostIntegrationCard({ isAdmin, provider }: ProviderHostIntegrationCardProps) {
  const { sources, save, saving } = useHostIntegrationsStore();
  const [draftSources, setDraftSources] = useState<HostIntegrationSource[] | null>(null);

  const sourceStatus = useMemo(
    () => sources.find((item) => item.kind === 'provider-default' && item.provider === provider) ?? null,
    [provider, sources],
  );

  const source = useMemo(() => {
    if (!sourceStatus) return null;
    return draftSources?.find((item) => item.id === sourceStatus.id) ?? cloneSources([sourceStatus])[0];
  }, [draftSources, sourceStatus]);

  const dirty = useMemo(() => {
    if (!sourceStatus || !source || !draftSources) return false;
    const original = cloneSources([sourceStatus])[0];
    return JSON.stringify(original) !== JSON.stringify(source);
  }, [draftSources, source, sourceStatus]);

  if (!sourceStatus || !source) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4 text-sm text-muted-foreground">
          暂未发现该 provider 的默认宿主来源。
        </CardContent>
      </Card>
    );
  }

  const updateSource = (updater: (current: HostIntegrationSource) => HostIntegrationSource) => {
    setDraftSources((prev) => {
      const base = prev ?? cloneSources([sourceStatus]);
      return base.map((item) => (item.id === source.id ? updater(item) : item));
    });
  };

  const handleSave = async () => {
    try {
      await save(source ? [source, ...cloneSources(sources.filter((item) => item.id !== source.id))] : []);
      setDraftSources(null);
      toast.success('宿主来源配置已保存');
    } catch (err) {
      toast.error(getErrorMessage(err, '保存宿主来源配置失败'));
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">{source.label}</div>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${getStatusTone(sourceStatus.status)}`}>
                {sourceStatus.status}
              </span>
              <ProviderBadge provider={provider} />
            </div>
            <SourcePath source={source} isAdmin={false} />
          </div>
          {isAdmin && dirty && (
            <Button onClick={handleSave} disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存来源'}
            </Button>
          )}
        </div>

        <SourceToggles source={source} isAdmin={isAdmin} onChange={updateSource} />
        <SourceStatusHint source={{ ...sourceStatus, ...source }} />
      </CardContent>
    </Card>
  );
}

export function HostIntegrationsPanel({ isAdmin }: CustomHostIntegrationsPanelProps) {
  const { sources, save, saving } = useHostIntegrationsStore();
  const [draftSources, setDraftSources] = useState<HostIntegrationSource[] | null>(null);
  const [newPath, setNewPath] = useState('');

  const customStatuses = useMemo(() => sources.filter((item) => item.kind === 'custom'), [sources]);
  const activeSources = draftSources ?? cloneSources(customStatuses);
  const dirty = useMemo(() => {
    if (!draftSources) return false;
    return JSON.stringify(draftSources) !== JSON.stringify(cloneSources(customStatuses));
  }, [customStatuses, draftSources]);
  const statusMap = useMemo(
    () => new Map(customStatuses.map((item) => [item.id, item])),
    [customStatuses],
  );

  const updateSource = (id: string, updater: (source: HostIntegrationSource) => HostIntegrationSource) => {
    setDraftSources((prev) => {
      const base = prev ?? cloneSources(customStatuses);
      return base.map((source) => (source.id === id ? updater(source) : source));
    });
  };

  const handleAddSource = () => {
    const path = newPath.trim();
    if (!path) {
      toast.error('请输入来源路径');
      return;
    }
    setDraftSources((prev) => {
      const base = prev ?? cloneSources(customStatuses);
      return [
        ...base,
        {
          id: `custom-${Date.now().toString(36)}`,
          kind: 'custom',
          label: path,
          path,
          enabled: true,
          skillsEnabled: true,
          mcpEnabled: true,
        },
      ];
    });
    setNewPath('');
  };

  const removeSource = (id: string) => {
    setDraftSources((prev) => {
      const base = prev ?? cloneSources(customStatuses);
      return base.filter((source) => source.id !== id);
    });
  };

  const handleSave = async () => {
    try {
      const providerDefaults = cloneSources(sources.filter((item) => item.kind === 'provider-default'));
      await save([...providerDefaults, ...activeSources]);
      setDraftSources(null);
      toast.success('自定义宿主来源已保存');
    } catch (err) {
      toast.error(getErrorMessage(err, '保存自定义宿主来源失败'));
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold">自定义来源</div>
            <div className="mt-1 text-sm text-muted-foreground">
              这里用于接入额外的宿主目录，例如 `~/.agent`。自定义来源不绑定 provider，会作为默认来源之上的覆盖层。
            </div>
          </div>
          {isAdmin && dirty && (
            <Button onClick={handleSave} disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存配置'}
            </Button>
          )}
        </div>

        {isAdmin && (
          <div className="rounded-lg border border-dashed border-border p-3">
            <div className="mb-2 text-sm font-medium">添加自定义来源</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="例如 ~/.agent"
              />
              <Button onClick={handleAddSource}>
                <Plus size={16} />
                添加
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {customStatuses.length === 0 && activeSources.length === 0 ? (
            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              暂无自定义宿主来源。
            </div>
          ) : (
            activeSources.map((source) => {
              const statusSource = statusMap.get(source.id);
              const sourceStatus: HostIntegrationSourceStatus = statusSource ?? {
                ...source,
                status: 'invalid',
                message: '尚未保存，保存后将进行路径校验',
              };
              return (
                <div key={source.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{source.label}</div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${getStatusTone(sourceStatus.status)}`}>
                          {sourceStatus.status}
                        </span>
                      </div>
                      <SourcePath
                        source={source}
                        isAdmin={isAdmin}
                        editable
                        onChange={(nextPath) =>
                          updateSource(source.id, (current) => ({
                            ...current,
                            path: nextPath,
                            label: nextPath || current.label,
                          }))
                        }
                      />
                    </div>
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => removeSource(source.id)}>
                        <Trash2 size={16} />
                        删除
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    <SourceToggles
                      source={source}
                      isAdmin={isAdmin}
                      onChange={(updater) => updateSource(source.id, updater)}
                    />
                    <SourceStatusHint source={{ ...sourceStatus, ...source }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
