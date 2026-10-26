import { getFirebaseAuth } from './firebase';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type Source = {
  id: string;
  domain: string;
  act: string;
  year: string;
  actNo: string;
  section: string;
  title: string;
  chapter: string;
  score: number;
  excerpt: string;
};
export type RouteInfo = {
  type: 'law' | 'general' | 'unsupported';
  domains: { id: string; label: string }[];
};
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  route?: RouteInfo | null;
};
export type ChatSummary = { id: string; title: string; updatedAt: number };
/** auto = the router decides; general = straight to Gemini; law = search one database. */
export type Mode = 'auto' | 'general' | 'law';
export type LawDomain = { id: string; label: string; description: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('You are signed out. Please sign in again.');
  const token = await user.getIdToken(); // refreshed automatically when expired

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(msg || 'Something went wrong. Try again.');
  }
  return data as T;
}

export const listChats = () => request<ChatSummary[]>('/chats');

export const getChat = (id: string) =>
  request<{ id: string; title: string; messages: Message[] }>(`/chats/${id}`);

export const deleteChat = (id: string) =>
  request<{ deleted: boolean }>(`/chats/${id}`, { method: 'DELETE' });

export const listDomains = () => request<LawDomain[]>('/domains');

export const sendMessage = (
  chatId: string | null,
  message: string,
  mode: Mode = 'auto',
  domain?: string | null,
) =>
  request<{
    chatId: string;
    title: string;
    updatedAt: number;
    reply: string;
    sources: Source[];
    route: RouteInfo;
  }>('/chat', {
    method: 'POST',
    body: JSON.stringify({
      ...(chatId ? { chatId } : {}),
      message,
      mode,
      ...(mode === 'law' && domain ? { domain } : {}),
    }),
  });
