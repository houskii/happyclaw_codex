import { useEffect, useMemo } from 'react';
import { RefreshCw, Zap, ArrowUpRight, ArrowDownRight, DollarSign, MessageSquare, Database } from 'lucide-react';
import { useUsageStore } from '../stores/usage';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonStatCards } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';

const PERIOD_OPTIONS = [
  { label: '7 天', value: 7 },
  { label: '14 天', value: 14 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
];

const CHART_COLORS = [
  'var(--color-primary)',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#f97316',
  '#ec4899',
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd > 0) return `$${usd.toFixed(4)}`;
  return '$0.00';
}

export function UsagePage() {
  const { summary, breakdown, days, loading, error, loadStats, setDays } = useUsageStore();

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Aggregate daily data for chart
  const dailyData = useMemo(() => {
    const byDate = new Map<string, { date: string; input: number; output: number; cacheRead: number; cost: number; messages: number }>();
    for (const row of breakdown) {
      const existing = byDate.get(row.date);
      if (existing) {
        existing.input += row.input_tokens;
        existing.output += row.output_tokens;
        existing.cacheRead += row.cache_read_tokens;
        existing.cost += row.cost_usd;
        existing.messages += row.message_count;
      } else {
        byDate.set(row.date, {
          date: row.date,
          input: row.input_tokens,
          output: row.output_tokens,
          cacheRead: row.cache_read_tokens,
          cost: row.cost_usd,
          messages: row.message_count,
        });
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [breakdown]);

  // Model breakdown for pie chart
  const modelData = useMemo(() => {
    const byModel = new Map<string, { model: string; cost: number; tokens: number }>();
    for (const row of breakdown) {
      const existing = byModel.get(row.model);
      if (existing) {
        existing.cost += row.cost_usd;
        existing.tokens += row.input_tokens + row.output_tokens;
      } else {
        byModel.set(row.model, {
          model: row.model,
          cost: row.cost_usd,
          tokens: row.input_tokens + row.output_tokens,
        });
      }
    }
    return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
  }, [breakdown]);

  return (
    <div className="min-h-full bg-background p-4 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="用量统计"
          subtitle={`过去 ${days} 天的 Token 用量和费用`}
          className="mb-6"
          actions={
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border overflow-hidden">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDays(opt.value)}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      days === opt.value
                        ? 'bg-primary text-white'
                        : 'bg-card text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={() => loadStats()} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        />

        {loading && !summary && <SkeletonStatCards />}

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {summary && (
          <div className="space-y-6">
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<ArrowDownRight className="w-5 h-5" />}
                label="输入 Token"
                value={formatTokens(summary.totalInputTokens)}
                color="text-blue-600 dark:text-blue-400"
                bgColor="bg-blue-50 dark:bg-blue-950"
              />
              <StatCard
                icon={<ArrowUpRight className="w-5 h-5" />}
                label="输出 Token"
                value={formatTokens(summary.totalOutputTokens)}
                color="text-green-600 dark:text-green-400"
                bgColor="bg-green-50 dark:bg-green-950"
              />
              <StatCard
                icon={<DollarSign className="w-5 h-5" />}
                label="总费用"
                value={formatCost(summary.totalCostUSD)}
                color="text-amber-600 dark:text-amber-400"
                bgColor="bg-amber-50 dark:bg-amber-950"
              />
              <StatCard
                icon={<MessageSquare className="w-5 h-5" />}
                label="对话次数"
                value={String(summary.totalMessages)}
                color="text-purple-600 dark:text-purple-400"
                bgColor="bg-purple-50 dark:bg-purple-950"
              />
            </div>

            {/* Cache Stats */}
            {(summary.totalCacheReadTokens > 0 || summary.totalCacheCreationTokens > 0) && (
              <div className="grid grid-cols-2 gap-4">
                <StatCard
                  icon={<Database className="w-5 h-5" />}
                  label="缓存读取"
                  value={formatTokens(summary.totalCacheReadTokens)}
                  color="text-cyan-600 dark:text-cyan-400"
                  bgColor="bg-cyan-50 dark:bg-cyan-950"
                />
                <StatCard
                  icon={<Zap className="w-5 h-5" />}
                  label="缓存创建"
                  value={formatTokens(summary.totalCacheCreationTokens)}
                  color="text-orange-600 dark:text-orange-400"
                  bgColor="bg-orange-50 dark:bg-orange-950"
                />
              </div>
            )}

            {/* Daily Token Chart */}
            {dailyData.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-4 lg:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">每日 Token 用量</h2>
                <div className="h-64 lg:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                        tickFormatter={(v: string) => v.slice(5)} // MM-DD
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                        tickFormatter={formatTokens}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: 'var(--foreground)',
                        }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(value: any, name: any) => [formatTokens(Number(value) || 0), String(name)]}
                        labelFormatter={(label) => `日期: ${label}`}
                      />
                      <Legend />
                      <Bar dataKey="input" name="输入" stackId="tokens" fill="var(--color-primary)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="output" name="输出" stackId="tokens" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Daily Cost Chart */}
            {dailyData.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-4 lg:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">每日费用</h2>
                <div className="h-64 lg:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                        tickFormatter={(v: string) => v.slice(5)}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                        tickFormatter={(v) => formatCost(Number(v))}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: 'var(--foreground)',
                        }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(value: any) => [formatCost(Number(value) || 0), '费用']}
                        labelFormatter={(label) => `日期: ${label}`}
                      />
                      <Bar dataKey="cost" name="费用 (USD)" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Model Breakdown */}
            {modelData.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-4 lg:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">模型用量分布</h2>
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Pie Chart */}
                  <div className="h-64 w-full lg:w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={modelData}
                          dataKey="cost"
                          nameKey="model"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          label={(props: any) =>
                            `${String(props.model ?? '').replace('claude-', '')} ${((Number(props.percent) || 0) * 100).toFixed(0)}%`
                          }
                        >
                          {modelData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: 'var(--foreground)',
                          }}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(value: any) => [formatCost(Number(value) || 0), '费用']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Table */}
                  <div className="w-full lg:w-1/2">
                    <table className="min-w-full divide-y divide-border">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">模型</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Token</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">费用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {modelData.map((row, i) => (
                          <tr key={row.model} className="hover:bg-muted/50">
                            <td className="px-3 py-2 text-sm text-foreground">
                              <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                              {row.model}
                            </td>
                            <td className="px-3 py-2 text-sm text-right text-muted-foreground">{formatTokens(row.tokens)}</td>
                            <td className="px-3 py-2 text-sm text-right text-foreground font-medium">{formatCost(row.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {dailyData.length === 0 && !loading && (
              <div className="bg-card rounded-xl border border-border p-12 text-center">
                <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">暂无用量数据</h3>
                <p className="text-muted-foreground">
                  与 AI 对话后，用量数据将自动记录在这里
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
