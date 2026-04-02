import { useEffect, useState } from 'react';

import { useAuthStore } from '@/stores/auth';
import { useHostIntegrationsStore } from '@/stores/host-integrations';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClaudeProviderSection } from './ClaudeProviderSection';
import { CodexProviderSection } from './CodexProviderSection';
import {
  HostIntegrationsPanel,
  HostIntegrationsSummary,
  ProviderHostIntegrationCard,
} from './HostIntegrationsPanel';

export function ProvidersSection() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const loadHostIntegrations = useHostIntegrationsStore((s) => s.load);

  useEffect(() => {
    loadHostIntegrations();
  }, [loadHostIntegrations]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-sm font-medium text-foreground">Provider 管理</div>
        <p className="mt-1 text-xs text-muted-foreground">
          这里管理系统级模型接入能力。Anthropic 通道用于 Anthropic 生态接入，OpenAI 通道用于 OpenAI API 与 CLI 模式。
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success">
          {notice}
        </div>
      )}

      <HostIntegrationsSummary isAdmin={isAdmin} />

      <Tabs defaultValue="anthropic" className="space-y-4">
        <TabsList>
          <TabsTrigger value="anthropic">Claude</TabsTrigger>
          <TabsTrigger value="openai">Codex</TabsTrigger>
        </TabsList>

        <TabsContent value="anthropic" className="space-y-4">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Claude</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                管理 Anthropic 登录态、API Key、第三方 Anthropic 兼容网关与负载均衡，以及绑定到 `~/.claude` 的默认宿主来源接入。
              </p>
            </div>
            <ClaudeProviderSection setNotice={setNotice} setError={setError} />
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Claude 宿主来源</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                当前 provider 默认绑定到 `~/.claude`。你可以分别控制它向 Skills 与 MCP 暴露内容。
              </p>
            </div>
            <ProviderHostIntegrationCard isAdmin={isAdmin} provider="anthropic" />
          </section>
        </TabsContent>

        <TabsContent value="openai" className="space-y-4">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Codex</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                管理 CLI 登录态、OpenAI API Key profiles，以及默认模型、自定义环境变量和绑定到 `~/.codex` 的默认宿主来源接入。
              </p>
            </div>
            <CodexProviderSection setNotice={setNotice} setError={setError} />
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Codex 宿主来源</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                当前 provider 默认绑定到 `~/.codex`。你可以分别控制它向 Skills 与 MCP 暴露内容。
              </p>
            </div>
            <ProviderHostIntegrationCard isAdmin={isAdmin} provider="openai" />
          </section>
        </TabsContent>
      </Tabs>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">自定义来源</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            用于接入额外的宿主目录，例如 `~/.agent`。自定义来源不绑定 provider，会在默认来源之上作为覆盖层生效。
          </p>
        </div>
        <HostIntegrationsPanel isAdmin={isAdmin} />
      </section>
    </div>
  );
}
