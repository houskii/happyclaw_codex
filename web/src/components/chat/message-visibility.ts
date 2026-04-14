import type { Message } from '../../stores/chat';

const ROUTING_NOTICE_WINDOW_MS = 30_000;

const ROUTING_NOTICE_PATTERNS = [
  /(?:我|已|已经|也)?在飞书(?:里)?(?:回复|回了|说明|同步|发了)/,
  /(?:我|已|已经|也)?在(?:telegram|qq|im)(?:里)?(?:回复|回了|说明|同步|发了)/i,
  /(?:已|已经|我也?)?(?:通过|在).*?(?:飞书|telegram|qq|im).*?(?:回复|回了|同步)/i,
];

const PROGRESS_ACK_PATTERNS = [
  /^(?:我先|我这就|我去|我先帮你|我帮你先)/,
  /(?:我查一下|我看一下|我看下|我确认一下|我核对一下|我先拉一下|我先查一下)/,
  /(?:稍等|等我|稍等几分钟|马上回你|一会儿回你)/,
];

function isAssistantMessage(message: Message): boolean {
  return message.is_from_me && message.sender !== '__system__';
}

function isSystemMessage(message: Message): boolean {
  return message.sender === '__system__';
}

function getMessageHead(message: Message): string {
  return message.content
    .trim()
    .slice(0, 160)
    .replace(/[`*_>#-]/g, ' ');
}

function isRoutingNotice(message: Message): boolean {
  const head = getMessageHead(message);
  return ROUTING_NOTICE_PATTERNS.some((pattern) => pattern.test(head));
}

function isProgressAck(message: Message): boolean {
  if (message.source_kind !== 'sdk_send_message') return false;
  const head = getMessageHead(message);
  if (head.length > 120) return false;
  return PROGRESS_ACK_PATTERNS.some((pattern) => pattern.test(head));
}

function getTimestampMs(message: Message): number {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isWithinRoutingWindow(a: Message, b: Message): boolean {
  return Math.abs(getTimestampMs(a) - getTimestampMs(b)) <= ROUTING_NOTICE_WINDOW_MS;
}

function getAdjacentAssistantMessage(
  messages: Message[],
  startIndex: number,
  direction: 1 | -1,
): Message | null {
  for (
    let index = startIndex + direction;
    index >= 0 && index < messages.length;
    index += direction
  ) {
    const candidate = messages[index];
    if (!candidate) return null;
    if (isSystemMessage(candidate)) continue;
    if (!isAssistantMessage(candidate)) return null;
    return candidate;
  }
  return null;
}

function shouldHideRoutingSibling(current: Message, sibling: Message | null): boolean {
  if (!sibling) return false;
  if (!isWithinRoutingWindow(current, sibling)) return false;

  const currentIsSend = current.source_kind === 'sdk_send_message';
  const siblingIsSend = sibling.source_kind === 'sdk_send_message';
  if (currentIsSend === siblingIsSend) return false;

  const currentRouting = isRoutingNotice(current);
  const siblingRouting = isRoutingNotice(sibling);
  if (currentRouting !== siblingRouting) {
    return currentRouting;
  }

  const sendMessage = currentIsSend ? current : sibling;
  if (isProgressAck(sendMessage)) {
    return false;
  }

  // The user chose IM as canonical. When a substantive send_message is
  // followed by a web-only final, keep the IM-delivered content and hide
  // the trailing duplicate in Web.
  return !currentIsSend;
}

export function getVisibleMessages(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;

  return messages.filter((message, index) => {
    if (!isAssistantMessage(message)) {
      return true;
    }

    const previousAssistant = getAdjacentAssistantMessage(messages, index, -1);
    if (shouldHideRoutingSibling(message, previousAssistant)) {
      return false;
    }

    const nextAssistant = getAdjacentAssistantMessage(messages, index, 1);
    if (shouldHideRoutingSibling(message, nextAssistant)) {
      return false;
    }

    return true;
  });
}
