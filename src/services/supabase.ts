import { createClient } from '@supabase/supabase-js';
import { EmailAccount, SyncLog, SyncRule, Invoice } from '../types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function getEmailAccounts(accountId?: string): Promise<EmailAccount[]> {
  let query = supabase.from('email_accounts').select('*');
  
  if (accountId) {
    query = query.eq('id', accountId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
}

export async function getSyncRules(): Promise<SyncRule[]> {
  const { data, error } = await supabase
    .from('sync_rules')
    .select('*')
    .eq('is_active', true);
  
  if (error) throw error;
  return data || [];
}

export async function createSyncLog(params: {
  totalAccounts: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<SyncLog> {
  const { data, error } = await supabase
    .from('sync_logs')
    .insert({
      status: 'running',
      total_accounts: params.totalAccounts,
      processed_accounts: 0,
      total_invoices: 0,
      emails_processed_so_far: 0,
      total_emails_to_process: 0,
      date_from: params.dateFrom || null,
      date_to: params.dateTo || null,
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateSyncLog(id: string, updates: Partial<SyncLog>): Promise<void> {
  const { error } = await supabase
    .from('sync_logs')
    .update(updates)
    .eq('id', id);
  
  if (error) throw error;
}

export async function getSyncLog(id: string): Promise<SyncLog | null> {
  const { data, error } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

export async function updateAccountStatus(
  accountId: string, 
  status: string, 
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .update({
      status,
      error_message: errorMessage || null,
      last_sync_at: status === 'connected' ? new Date().toISOString() : undefined,
    })
    .eq('id', accountId);
  
  if (error) throw error;
}

export async function updateAccountLastUid(accountId: string, uid: number): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .update({ last_processed_uid: uid })
    .eq('id', accountId);
  
  if (error) throw error;
}

export async function checkDuplicateInvoice(
  emailAccountId: string,
  emailMessageId: string,
  filename: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('email_account_id', emailAccountId)
    .eq('email_message_id', emailMessageId)
    .eq('filename', filename)
    .maybeSingle();
  
  if (error) throw error;
  return !!data;
}

export async function insertInvoice(invoice: Omit<Invoice, 'id' | 'created_at'>): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .insert(invoice)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function insertPendingLink(params: {
  emailAccountId: string;
  detectedUrl: string;
  detectedAmount: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  emailDate: string | null;
  emailMessageId: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('pending_invoice_links')
    .insert({
      email_account_id: params.emailAccountId,
      detected_url: params.detectedUrl,
      detected_amount: params.detectedAmount,
      email_subject: params.emailSubject,
      email_from: params.emailFrom,
      email_date: params.emailDate,
      email_message_id: params.emailMessageId,
      status: 'pending',
    });
  
  if (error && !error.message.includes('duplicate')) throw error;
}

export async function uploadToStorage(
  bucket: string,
  path: string,
  content: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, content, {
      contentType,
      upsert: true,
    });
  
  if (error) throw error;
  
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  
  return urlData.publicUrl;
}
