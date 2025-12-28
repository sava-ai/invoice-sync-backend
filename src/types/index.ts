export interface EmailAccount {
  id: string;
  email: string;
  username: string;
  password: string;
  imap_host: string;
  imap_port: number;
  use_ssl: boolean;
  last_processed_uid: number | null;
  last_sync_at: string | null;
  status: string;
  error_message: string | null;
  pending_uids: number | null;
}

export interface SyncLog {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_accounts: number;
  processed_accounts: number;
  total_invoices: number;
  total_emails_to_process: number | null;
  emails_processed_so_far: number | null;
  current_account_email: string | null;
  sync_message: string | null;
  error_message: string | null;
  date_from: string | null;
  date_to: string | null;
  is_continuation: boolean | null;
}

export interface SyncRule {
  id: string;
  name: string;
  rule_type: string;
  condition_type: string;
  condition_value: string;
  is_active: boolean;
}

export interface Invoice {
  id: string;
  email_account_id: string;
  filename: string;
  file_path: string;
  file_size: number | null;
  email_subject: string | null;
  email_from: string | null;
  email_date: string | null;
  email_message_id: string | null;
  vendor: string | null;
  amount: number | null;
  tags: string[] | null;
  source_type: string;
  created_at: string;
}

export interface SyncRequest {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SyncResponse {
  syncLogId: string;
  status: string;
  message: string;
}

export interface ProcessedEmail {
  uid: number;
  subject: string;
  from: string;
  date: Date;
  messageId: string;
  attachments: ProcessedAttachment[];
  invoiceLinks: InvoiceLink[];
}

export interface ProcessedAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  size: number;
}

export interface InvoiceLink {
  url: string;
  amount: string | null;
}
