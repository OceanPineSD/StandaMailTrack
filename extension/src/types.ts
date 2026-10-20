/** Shapes the Worker's read routes answer with. */
export interface Location {
  city: string | null;
  country: string | null;
  via_proxy: boolean;
}

export interface EmailRecord {
  id: string;
  subject: string;
  recipients: string[];
  recipient_count: number;
  sent_at: number;
  thread_id: string | null;
  message_id: string | null;
}

/** One email of a thread in GET /api/threads. */
export interface EmailSummary extends EmailRecord {
  open_count: number;
  first_open: number | null;
  last_open: number | null;
  click_count: number;
  last_location: Location | null;
}

export interface OpenEvent {
  at: number;
  via_proxy: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  ua: string | null;
}

export interface ClickEvent {
  at: number;
  link_idx: number;
  url: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ua: string | null;
}

/** GET /api/emails/:id */
export interface EmailDetail {
  email: EmailRecord;
  opens: OpenEvent[];
  clicks: ClickEvent[];
}

/** One settled open or click from /api/events, with its email's subject and recipients. */
export interface TrackEvent {
  type: "open" | "click";
  id: number;
  email_id: string;
  at: number;
  via_proxy: boolean;
  city: string | null;
  country: string | null;
  url: string | null;
  subject: string;
  recipients: string[];
  recipient_count: number;
}

export interface EventsPage {
  events: TrackEvent[];
  cursor: string;
}
