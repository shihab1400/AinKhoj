export interface Source {
  id: string;
  /** Human label of the knowledge base this came from, e.g. "Criminal law" */
  domain: string;
  act: string;
  year: string;
  actNo: string;
  section: string;
  title: string;
  chapter: string;
  score: number;
  excerpt: string;
}

/** One searchable knowledge base = one .jsonl file in backend/data. */
export interface Domain {
  id: string;
  label: string;
  description: string;
  chunks: number;
  acts: string[];
}

/** How a question was handled; stored with the answer and shown in the UI. */
export interface RouteInfo {
  type: 'law' | 'general' | 'unsupported';
  domains: { id: string; label: string }[];
}
