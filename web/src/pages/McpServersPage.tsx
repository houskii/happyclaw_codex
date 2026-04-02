import { useEffect, useState, useMemo } from 'react';
import { AlertTriangle, Plus, RefreshCw, Server } from 'lucide-react';
import { SearchInput } from '@/components/common';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMcpServersStore } from '../stores/mcp-servers';
import { useAuthStore } from '../stores/auth';
import { McpServerCard } from '../components/mcp-servers/McpServerCard';
import { McpServerDetail } from '../components/mcp-servers/McpServerDetail';
import { AddMcpServerDialog } from '../components/mcp-servers/AddMcpServerDialog';

export function McpServersPage() {
  const {
    servers,
    conflicts,
    loading,
    error,
    loadServers,
    addServer,
    updateConflict,
  } = useMcpServersStore();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return servers.filter(
      (s) =>
        !q ||
        s.id.toLowerCase().includes(q) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.url && s.url.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)),
    );
  }, [servers, searchQuery]);

  const manualServers = filtered.filter((s) => !s.syncedFromHost);
  const syncedServers = filtered.filter((s) => s.syncedFromHost);

  const enabledCount = servers.filter((s) => s.enabled).length;
  const selectedServer = servers.find((s) => s.id === selectedId) || null;

  const handleAdd = async (server: Parameters<typeof addServer>[0]) => {
    await addServer(server);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-background border-b border-border px-6 py-4">
          <PageHeader
            title="MCP 服务器"
            subtitle={`共 ${servers.length} 个${syncedServers.length > 0 ? `（含同步 ${syncedServers.length}）` : ''} · 启用 ${enabledCount}`}
            actions={
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={loadServers} disabled={loading}>
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  刷新
                </Button>
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus size={18} />
                  添加
                </Button>
              </div>
            }
          />
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {conflicts.length > 0 && (
            <Card className="border-warning/30 bg-warning-bg/30">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertTriangle size={16} className="text-warning" />
                  冲突 MCP 版本管理
                </div>
                <div className="space-y-3">
                  {conflicts.map((conflict) => (
                    <div
                      key={conflict.itemId}
                      className="rounded-lg border border-border/60 bg-background p-3"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-medium text-foreground">
                            {conflict.itemId}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            当前生效：
                            <span className="ml-1 font-medium text-foreground">
                              {conflict.effectiveSourceLabel ?? '未选择'}
                            </span>
                            {conflict.effectiveSourcePath && (
                              <span className="ml-1 font-mono">
                                {conflict.effectiveSourcePath}
                              </span>
                            )}
                          </div>
                          {conflict.warning && (
                            <div className="text-xs text-warning">
                              {conflict.warning}
                            </div>
                          )}
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {conflict.candidates.map((candidate) => (
                              <div key={candidate.sourceId}>
                                {candidate.sourceLabel}
                                <span className="ml-1 font-mono">
                                  {candidate.sourcePath}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="w-full lg:w-64">
                          <Select
                            value={
                              conflict.mode === 'pinned' && conflict.pinnedSourceId
                                ? conflict.pinnedSourceId
                                : 'auto'
                            }
                            disabled={!isAdmin}
                            onValueChange={(value) => {
                              void updateConflict(
                                conflict.itemId,
                                value === 'auto' ? 'auto' : 'pinned',
                                value === 'auto' ? undefined : value,
                              );
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">自动（按来源优先级）</SelectItem>
                              {conflict.candidates.map((candidate) => (
                                <SelectItem
                                  key={candidate.sourceId}
                                  value={candidate.sourceId}
                                >
                                  {candidate.sourceLabel}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!isAdmin && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              仅管理员可调整生效版本
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="border-border/60 bg-muted/20">
            <CardContent className="p-4 text-sm text-muted-foreground">
              宿主来源路径与 MCP 接入开关已统一收口到
              <span className="mx-1 font-medium text-foreground">设置 → Provider 管理</span>
              中配置；这里仅展示同步后的服务器列表。
            </CardContent>
          </Card>

          <div className="flex gap-6">
          {/* Left list */}
          <div className="w-full lg:w-1/2 xl:w-2/5">
            <div className="mb-4">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="搜索 ID、命令或 URL"
              />
            </div>

            <div className="space-y-6">
              {loading && servers.length === 0 ? (
                <SkeletonCardList count={3} />
              ) : error ? (
                <Card className="border-error/20">
                  <CardContent className="text-center">
                    <p className="text-error">{error}</p>
                  </CardContent>
                </Card>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title={searchQuery ? '没有找到匹配的 MCP 服务器' : '暂无 MCP 服务器'}
                  description={searchQuery ? undefined : '点击"添加"按钮添加第一个 MCP 服务器'}
                />
              ) : (
                <>
                  {manualServers.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                        手动添加 ({manualServers.length})
                      </h2>
                      <div className="space-y-2">
                        {manualServers.map((server) => (
                          <McpServerCard
                            key={server.id}
                            server={server}
                            selected={selectedId === server.id}
                            onSelect={() => setSelectedId(server.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {syncedServers.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                        宿主机同步 ({syncedServers.length})
                      </h2>
                      <div className="space-y-2">
                        {syncedServers.map((server) => (
                          <McpServerCard
                            key={server.id}
                            server={server}
                            selected={selectedId === server.id}
                            onSelect={() => setSelectedId(server.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right detail (desktop) */}
          <div className="hidden lg:block lg:w-1/2 xl:w-3/5">
            <McpServerDetail server={selectedServer} onDeleted={() => setSelectedId(null)} />
          </div>
          </div>
        </div>

        {/* Mobile detail */}
        {selectedId && selectedServer && (
          <div className="lg:hidden p-4">
            <McpServerDetail server={selectedServer} onDeleted={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      <AddMcpServerDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAdd}
      />
    </div>
  );
}
