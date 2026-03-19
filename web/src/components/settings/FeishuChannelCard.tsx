import { useCallback, useEffect, useState } from 'react';
import { Loader2, ExternalLink, ShieldCheck, ShieldX } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { api } from '../../api/client';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';

interface UserFeishuConfig {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  enabled: boolean;
  connected: boolean;
  updatedAt: string | null;
}

interface OAuthStatus {
  authorized: boolean;
  hasAppCredentials: boolean;
  authorizedAt?: string | null;
  scopes?: string;
  tokenExpired?: boolean;
  hasRefreshToken?: boolean;
}

interface FeishuChannelCardProps extends SettingsNotification {}

export function FeishuChannelCard({ setNotice, setError }: FeishuChannelCardProps) {
  const [config, setConfig] = useState<UserFeishuConfig | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);

  const enabled = config?.enabled ?? false;

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<UserFeishuConfig>('/api/config/user-im/feishu');
      setConfig(data);
      setAppId(data.appId || '');
      setAppSecret('');
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOAuthStatus = useCallback(async () => {
    try {
      const data = await api.get<OAuthStatus>('/api/config/user-im/feishu/oauth-status');
      setOauthStatus(data);
    } catch {
      setOauthStatus(null);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadOAuthStatus();
  }, [loadConfig, loadOAuthStatus]);

  // Check for OAuth success redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      loadOAuthStatus();
      setNotice('飞书文档授权成功！');
      // Clean up URL
      params.delete('oauth');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [loadOAuthStatus, setNotice]);

  const handleOAuthAuthorize = async () => {
    setOauthLoading(true);
    setError(null);
    try {
      const data = await api.get<{ url: string }>('/api/config/user-im/feishu/oauth-url');
      // Open Feishu OAuth page
      window.location.href = data.url;
    } catch (err) {
      setError(getErrorMessage(err, '获取授权链接失败'));
      setOauthLoading(false);
    }
  };

  const handleOAuthRevoke = async () => {
    setOauthLoading(true);
    setError(null);
    try {
      await api.delete('/api/config/user-im/feishu/oauth-revoke');
      setOauthStatus({ authorized: false, hasAppCredentials: oauthStatus?.hasAppCredentials ?? false });
      setNotice('已撤销飞书文档授权');
    } catch (err) {
      setError(getErrorMessage(err, '撤销授权失败'));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleToggle = async (newEnabled: boolean) => {
    setToggling(true);
    setNotice(null);
    setError(null);
    try {
      const data = await api.put<UserFeishuConfig>('/api/config/user-im/feishu', { enabled: newEnabled });
      setConfig(data);
      setNotice(`飞书渠道已${newEnabled ? '启用' : '停用'}`);
    } catch (err) {
      setError(getErrorMessage(err, '切换飞书渠道状态失败'));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const id = appId.trim();
      const secret = appSecret.trim();

      if (id && !secret && !config?.hasAppSecret) {
        setError('首次配置飞书需要同时提供 App ID 和 App Secret');
        setSaving(false);
        return;
      }

      if (!id && !secret) {
        if (config?.appId || config?.hasAppSecret) {
          setNotice('飞书配置未变更');
        } else {
          setError('请填写飞书 App ID 和 App Secret');
        }
        setSaving(false);
        return;
      }

      const payload: Record<string, string | boolean> = { enabled: true };
      if (id) payload.appId = id;
      if (secret) payload.appSecret = secret;
      const data = await api.put<UserFeishuConfig>('/api/config/user-im/feishu', payload);
      setConfig(data);
      setAppSecret('');
      setNotice('飞书配置已保存');
    } catch (err) {
      setError(getErrorMessage(err, '保存飞书配置失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${config?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">飞书 Feishu</h3>
            <p className="text-xs text-slate-500 mt-0.5">前往<a href="https://open.larkoffice.com/app?lang=zh-CN" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline mx-0.5">飞书开放平台</a>创建应用，接收飞书群消息并通过 Agent 自动回复</p>
          </div>
        </div>
        <ToggleSwitch checked={enabled} disabled={loading || toggling} onChange={handleToggle} />
      </div>

      <div className={`px-5 py-4 space-y-4 transition-opacity ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {loading ? (
          <div className="text-sm text-slate-500">加载中...</div>
        ) : (
          <>
            {config?.hasAppSecret && (
              <div className="text-xs text-slate-500">
                当前 Secret: {config.appSecretMasked || '已配置'}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">App ID</label>
                <Input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="输入飞书 App ID"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">App Secret</label>
                <Input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={config?.hasAppSecret ? '留空不修改' : '输入飞书 App Secret'}
                />
              </div>
            </div>
            <div>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                保存飞书配置
              </Button>
            </div>

            {/* OAuth Document Access Section */}
            <div className="pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                {oauthStatus?.authorized ? (
                  <ShieldCheck className="size-4 text-emerald-500" />
                ) : (
                  <ShieldX className="size-4 text-slate-400" />
                )}
                <h4 className="text-xs font-semibold text-slate-700">
                  飞书文档访问授权
                </h4>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                授权后，Agent 可以直接读取你有权限访问的飞书文档和 Wiki 页面。
              </p>

              {oauthStatus?.authorized ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    已授权
                    {oauthStatus.authorizedAt && (
                      <span className="text-slate-400">
                        ({new Date(oauthStatus.authorizedAt).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOAuthRevoke}
                    disabled={oauthLoading}
                  >
                    {oauthLoading && <Loader2 className="size-3 animate-spin" />}
                    撤销授权
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={handleOAuthAuthorize}
                  disabled={oauthLoading || !config?.hasAppSecret}
                >
                  {oauthLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ExternalLink className="size-3" />
                  )}
                  授权飞书文档访问
                </Button>
              )}

              {!config?.hasAppSecret && !oauthStatus?.authorized && (
                <p className="text-xs text-amber-600 mt-1">
                  请先保存飞书 App ID 和 App Secret
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
