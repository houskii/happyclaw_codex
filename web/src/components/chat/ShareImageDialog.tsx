import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { Message } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import {
  ShareCardRenderer,
  SHARE_CARD_DEFAULT_WIDTH,
  SHARE_CARD_MAX_WIDTH,
  SHARE_CARD_PADDING,
} from './ShareCardRenderer';

interface ShareImageDialogProps {
  open: boolean;
  onClose: () => void;
  message: Message;
}

type GenerateState = 'generating' | 'preview' | 'error';

/**
 * Wait for Mermaid diagrams and images inside the container to finish rendering.
 */
function waitForRenderComplete(container: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);

    const check = () => {
      // Mermaid loading placeholders use animate-pulse
      const loading = container.querySelectorAll('.animate-pulse');
      const images = container.querySelectorAll('img');
      const allImagesLoaded = Array.from(images).every((img) => img.complete);
      if (loading.length === 0 && allImagesLoaded) {
        clearTimeout(timeout);
        // Small extra delay to let SVG painting settle
        setTimeout(resolve, 300);
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(container, { childList: true, subtree: true });
    check();
  });
}

export function ShareImageDialog({ open, onClose, message }: ShareImageDialogProps) {
  const [state, setState] = useState<GenerateState>('generating');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const currentUser = useAuthStore((s) => s.user);
  const appearance = useAuthStore((s) => s.appearance);

  const senderName = currentUser?.ai_name || appearance?.aiName || message.sender_name || 'AI';
  const aiEmoji = currentUser?.ai_avatar_emoji || appearance?.aiAvatarEmoji;
  const aiColor = currentUser?.ai_avatar_color || appearance?.aiAvatarColor;
  const aiImageUrl = currentUser?.ai_avatar_url;
  const assistantName = currentUser?.ai_name || appearance?.aiName || 'HappyClaw';

  const timestamp = new Date(message.timestamp)
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(/\//g, '-');

  const generate = useCallback(async () => {
    setState('generating');
    setDataUrl(null);
    setErrorMsg('');

    // Wait a tick for offscreen card to mount
    await new Promise((r) => setTimeout(r, 100));

    const el = cardRef.current;
    if (!el) {
      setState('error');
      setErrorMsg('渲染容器未就绪');
      return;
    }

    try {
      // Phase 1: Expand card to measure natural table widths (no wrapping constraint)
      el.style.width = `${SHARE_CARD_MAX_WIDTH}px`;
      await new Promise((r) => requestAnimationFrame(r));

      await waitForRenderComplete(el);

      // Measure widest table to determine optimal card width
      const tables = el.querySelectorAll('table');
      let maxTableWidth = 0;
      tables.forEach((table) => {
        maxTableWidth = Math.max(maxTableWidth, table.scrollWidth);
      });

      // Phase 2: Set card to optimal width — fits tables while capping at max
      const cardWidth = Math.max(
        SHARE_CARD_DEFAULT_WIDTH,
        Math.min(maxTableWidth + SHARE_CARD_PADDING, SHARE_CARD_MAX_WIDTH),
      );
      el.style.width = `${cardWidth}px`;
      await new Promise((r) => requestAnimationFrame(r));

      const url = await toPng(el, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
      });
      setDataUrl(url);
      setState('preview');
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : '生成图片失败');
    }
  }, []);

  useEffect(() => {
    if (open) generate();
  }, [open, generate]);

  // Cleanup data URL on unmount
  useEffect(() => {
    return () => {
      setDataUrl(null);
    };
  }, []);

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `share-${Date.now()}.png`;
    a.click();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Dialog card */}
      <div
        className="relative bg-card rounded-2xl shadow-2xl border border-border w-[90vw] max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">生成分享图片</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {state === 'generating' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw className="w-6 h-6 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">正在渲染图片...</span>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-sm text-destructive">{errorMsg}</span>
              <button
                onClick={generate}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
              >
                重试
              </button>
            </div>
          )}

          {state === 'preview' && dataUrl && (
            <img
              src={dataUrl}
              alt="分享预览"
              className="w-full rounded-lg border border-border"
            />
          )}
        </div>

        {/* Footer */}
        {state === 'preview' && (
          <div className="px-5 py-4 border-t border-border">
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Download className="w-4 h-4" />
              保存图片
            </button>
          </div>
        )}
      </div>

      {/* Offscreen rendering area — NOT display:none so Mermaid SVGs get proper dimensions */}
      <div style={{ position: 'fixed', left: -9999, top: 0, opacity: 0, pointerEvents: 'none' }}>
        <ShareCardRenderer
          ref={cardRef}
          content={message.content}
          senderName={senderName}
          timestamp={timestamp}
          groupJid={message.chat_jid}
          aiEmoji={aiEmoji}
          aiColor={aiColor}
          aiImageUrl={aiImageUrl}
          assistantName={assistantName}
        />
      </div>
    </div>,
    document.body,
  );
}
