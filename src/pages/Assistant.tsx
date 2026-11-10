import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, History, MessageSquarePlus, Send, Sparkles, Trash2, UserRound } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, PageHeader } from '../components/ui.tsx';
import { NerdMascot } from '../components/NerdMascot.tsx';
import { api, ApiError, formatDateTime } from '../lib/api.ts';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { useAiAccess } from '../components/AiAccess.tsx';
import type {
  AiStatus,
  ChatAskResponse,
  ChatMessageItem,
  Conversation,
} from '../lib/aiTypes.ts';

const suggestions = [
  'لماذا السماء زرقاء؟',
  'اشرح لي النسبية ببساطة.',
  'ما أهم أسباب الحرب العالمية الثانية؟',
  'أعطني خطة مراجعة لطيفة لأسبوع مزدحم.',
];

export default function AssistantPage() {
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api.get<{ conversations: Conversation[] }>('/ai/conversations');
      setConversations(data.conversations);
    } catch {
      /* قائمة المحادثات مساعدة وليست حرجة */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const statusData = await api.get<AiStatus>('/ai/status');
        if (!cancelled) setStatus(statusData);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل حالة الدردشة.');
        }
      }
      await refreshConversations();
      const wanted = Number(searchParams.get('conversation'));
      if (!cancelled && Number.isInteger(wanted) && wanted > 0) {
        await openConversation(wanted);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations, searchParams]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    if (messages.length === 0 && !loading) {
      container.scrollTop = 0;
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function openConversation(id: number | null) {
    setConversationId(id);
    setHistoryOpen(false);
    setError(null);
    if (id === null) {
      setMessages([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const data = await api.get<{ conversation: Conversation; messages: ChatMessageItem[] }>(
        `/ai/conversations/${id}`,
      );
      setMessages(data.messages);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل المحادثة.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    if (!requireKey()) return;
    setError(null);
    setInput('');
    const optimistic: ChatMessageItem = {
      id: -Date.now(),
      role: 'user',
      content: question,
      sources: [],
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setLoading(true);
    try {
      const data = await aiApi.post<ChatAskResponse>('/ai/chat', {
        question,
        conversationId,
      });
      setConversationId(data.conversation.id);
      setMessages((current) => [
        ...current,
        ...(data.message ? [data.message] : []),
      ]);
      if (status) {
        setStatus({ ...status, usedToday: status.usedToday + 1, remaining: data.usage.remainingToday });
      }
      await refreshConversations();
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setInput(question);
      if (isKeyProblem(caught)) openActivation('activate');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر إرسال الرسالة.');
    } finally {
      setLoading(false);
    }
  }

  async function removeConversation(id: number) {
    if (!window.confirm('حذف هذه المحادثة وكل رسائلها؟')) return;
    try {
      await api.del(`/ai/conversations/${id}`);
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف المحادثة.');
    }
  }

  return (
    <AppShell>
      <PageHeader
        className="assistant-header"
        eyebrow="مساحة مفتوحة"
        title="الدردشة"
        subtitle="تحدّث مع نيرد عن أي شيء: سؤال علمي، حدث تاريخي، فكرة تقنية، أو حتى حديث عادي. لا تحتاج إلى رفع كتاب."
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm lg:hidden"
              aria-expanded={historyOpen}
              aria-controls="assistant-history"
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <History size={14} />
              المحادثات
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void openConversation(null)}
            >
              <MessageSquarePlus size={14} />
              محادثة جديدة
            </button>
          </>
        }
      />

      {error && <Alert>{error}</Alert>}

      {!hasKey && (
        <div className="assistant-notice">
          <Alert tone="info">
            <span className="inline-flex flex-wrap items-center gap-2">
              الدردشة تحتاج مفتاح Groq API الخاص بك. أضفه مرة واحدة على هذا الجهاز لتفعيلها.
              <button type="button" className="btn btn-soft btn-sm" onClick={() => openActivation('activate')}>
                تفعيل الذكاء الاصطناعي
              </button>
            </span>
          </Alert>
        </div>
      )}

      <div className="assistant-layout grid gap-3 lg:grid-cols-[250px_1fr]">
        <aside
          id="assistant-history"
          className={`assistant-history card overflow-auto p-2 ${historyOpen ? 'is-open' : ''}`}
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1.5 py-1">
            <p className="text-xs font-bold">محادثاتي</p>
            {status && (
              <span className="badge badge-blue py-0 text-[9px]">المتبقي {status.remaining}</span>
            )}
          </div>
          <ul className="space-y-1">
            {conversations.length === 0 && (
              <li className="muted px-2 py-2 text-[11px] leading-6">لا محادثات محفوظة بعد.</li>
            )}
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openConversation(conversation.id)}
                  className={`min-w-0 flex-1 rounded-[10px_8px_11px_7px] border-2 px-2 py-1.5 text-start text-xs transition ${
                    conversation.id === conversationId
                      ? 'border-[var(--line)] bg-[var(--surface-hover)] shadow-[2px_2px_0_var(--shadow-color)]'
                      : 'border-transparent hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span className="block truncate font-bold">{conversation.title}</span>
                  <span className="muted block truncate text-[10px]">
                    {conversation.messageCount} رسالة · {formatDateTime(conversation.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="حذف المحادثة"
                  className="muted shrink-0 rounded-md p-1 transition hover:text-[var(--color-bad)]"
                  onClick={() => void removeConversation(conversation.id)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="assistant-chat card flex flex-col overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-[var(--line-soft)] bg-[var(--surface-solid)] px-3 py-2.5">
            <span className="chat-avatar bg-[color-mix(in_srgb,var(--blue)_45%,var(--surface))]">
              <Bot size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">نيرد · دردشة حرة</p>
              <p className="muted text-[10px]">
                {status ? 'متصل وجاهز' : 'جارٍ التهيئة'}
                {status ? ` · استخدمت اليوم ${status.usedToday}` : ''}
              </p>
            </div>
            <span className="badge badge-mint">أي موضوع</span>
          </div>

          <div
            ref={messagesRef}
            className="assistant-messages flex-1 space-y-3 overflow-auto bg-[color-mix(in_srgb,var(--bg)_45%,var(--surface))] p-3"
          >
            {messages.length === 0 && !historyLoading && (
              <div className="paper-note mx-auto max-w-lg p-4 text-center">
                <NerdMascot className="mx-auto w-24" />
                <p className="mt-1 text-base font-extrabold">أهلًا! أنا نيرد 👋</p>
                <p className="muted mt-1 text-xs leading-6">
                  اسألني عن أي شيء، أو خلينا نناقش فكرة جديدة. سأشرح بأسلوب طبيعي وأوضح أكثر عندما تحتاج.
                </p>
                <div className="mt-3 flex flex-col gap-1.5 text-start">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion-chip"
                      onClick={() => void send(suggestion)}
                      disabled={loading || !status}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {historyLoading && (
              <div className="space-y-2" aria-hidden="true">
                <div className="skeleton h-16 w-3/4" />
                <div className="skeleton ms-auto h-12 w-1/2" />
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <div key={message.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  <span
                    className={`chat-avatar ${
                      isUser
                        ? 'bg-[color-mix(in_srgb,var(--yellow)_55%,var(--surface))]'
                        : 'bg-[color-mix(in_srgb,var(--blue)_45%,var(--surface))]'
                    }`}
                  >
                    {isUser ? <UserRound size={14} /> : <Bot size={14} />}
                  </span>
                  <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
                    {isUser ? (
                      <div dir="auto" className="whitespace-pre-wrap">
                        {message.content}
                      </div>
                    ) : (
                      <MarkdownText content={message.content} compact ariaLabel="رد نيرد" />
                    )}
                    {!isUser && message.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-[var(--line-soft)] pt-2">
                        <span className="muted text-[10px]">المصادر:</span>
                        {message.sources.slice(0, 8).map((source) => (
                          <Link
                            key={`${source.bookId}-${source.pageFrom}-${source.pageTo}`}
                            to={source.contentId ? `/content/${source.contentId}` : `/books/${source.bookId}?page=${source.pageFrom}`}
                            className="rounded-md border-2 border-[var(--line)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-bold shadow-[1px_1px_0_var(--shadow-color)]"
                            title={source.contentTitle ?? source.bookTitle}
                          >
                            ص {source.pageFrom}
                            {source.pageTo !== source.pageFrom ? `–${source.pageTo}` : ''}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-2">
                <span className="chat-avatar bg-[color-mix(in_srgb,var(--blue)_45%,var(--surface))]">
                  <Bot size={14} />
                </span>
                <div className="chat-bubble chat-bubble-ai flex items-center gap-2 text-xs">
                  <Sparkles size={13} className="animate-pulse text-[var(--accent)]" />
                  نيرد يفكّر…
                </div>
              </div>
            )}
          </div>

          <form
            className="assistant-composer border-t-2 border-dashed border-[var(--line-soft)] p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="chat-composer">
              <textarea
                rows={1}
                className="input max-h-28 min-h-11 resize-none border-0 bg-transparent shadow-none focus:shadow-none"
                placeholder={status ? 'اكتب أي سؤال أو فكرة…' : 'جارٍ تجهيز الدردشة…'}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={loading || !status}
                aria-label="رسالتك"
                dir="auto"
              />
              <button
                type="submit"
                className="btn btn-primary shrink-0 px-3"
                disabled={loading || !input.trim() || !status}
                aria-label="إرسال"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="muted mt-2 text-center text-[10px] leading-5">
              إجابات من معرفة النموذج العام. الدردشة لا تحتاج رفع محتوى، ولا تُعدّ بديلًا عن مرجع متخصص.
            </p>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
