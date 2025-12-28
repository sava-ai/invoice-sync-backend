import { v4 as uuidv4 } from 'uuid';
import { EmailAccount, SyncRule, ProcessedEmail } from '../types';
import {
  getEmailAccounts,
  getSyncRules,
  createSyncLog,
  updateSyncLog,
  updateAccountStatus,
  updateAccountLastUid,
  checkDuplicateInvoice,
  insertInvoice,
  insertPendingLink,
  uploadToStorage,
} from '../services/supabase';
import {
  createImapConnection,
  connectImap,
  disconnectImap,
  openInbox,
  searchEmails,
  fetchEmail,
} from '../services/imap';

// Track active syncs to allow cancellation
const activeSyncs = new Map<string, { cancelled: boolean }>();

export function cancelSync(syncLogId: string): boolean {
  const sync = activeSyncs.get(syncLogId);
  if (sync) {
    sync.cancelled = true;
    return true;
  }
  return false;
}

export async function startSync(params: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<string> {
  const accounts = await getEmailAccounts(params.accountId);
  
  if (accounts.length === 0) {
    throw new Error('No email accounts found');
  }
  
  const syncLog = await createSyncLog({
    totalAccounts: accounts.length,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  
  // Start processing in background
  processAccounts(syncLog.id, accounts, params.dateFrom, params.dateTo);
  
  return syncLog.id;
}

async function processAccounts(
  syncLogId: string,
  accounts: EmailAccount[],
  dateFrom?: string,
  dateTo?: string
): Promise<void> {
  const syncState = { cancelled: false };
  activeSyncs.set(syncLogId, syncState);
  
  const rules = await getSyncRules();
  let totalInvoices = 0;
  let totalEmailsProcessed = 0;
  
  try {
    for (let i = 0; i < accounts.length; i++) {
      if (syncState.cancelled) {
        await updateSyncLog(syncLogId, {
          status: 'cancelled',
          sync_message: 'Sync cancelled by user',
          completed_at: new Date().toISOString(),
        });
        return;
      }
      
      const account = accounts[i];
      
      await updateSyncLog(syncLogId, {
        current_account_email: account.email,
        processed_accounts: i,
        sync_message: `Processing ${account.email}...`,
      });
      
      try {
        const result = await processAccount(
          syncLogId,
          account,
          rules,
          dateFrom,
          dateTo,
          syncState
        );
        
        totalInvoices += result.invoicesFound;
        totalEmailsProcessed += result.emailsProcessed;
        
        await updateSyncLog(syncLogId, {
          total_invoices: totalInvoices,
          emails_processed_so_far: totalEmailsProcessed,
        });
        
        await updateAccountStatus(account.id, 'connected');
      } catch (err: any) {
        console.error(`Error processing account ${account.email}:`, err);
        await updateAccountStatus(account.id, 'error', err.message);
      }
    }
    
    await updateSyncLog(syncLogId, {
      status: 'completed',
      processed_accounts: accounts.length,
      completed_at: new Date().toISOString(),
      sync_message: `Completed. Found ${totalInvoices} invoices from ${totalEmailsProcessed} emails.`,
    });
  } catch (err: any) {
    console.error('Sync failed:', err);
    await updateSyncLog(syncLogId, {
      status: 'failed',
      error_message: err.message,
      completed_at: new Date().toISOString(),
    });
  } finally {
    activeSyncs.delete(syncLogId);
  }
}

async function processAccount(
  syncLogId: string,
  account: EmailAccount,
  rules: SyncRule[],
  dateFrom?: string,
  dateTo?: string,
  syncState?: { cancelled: boolean }
): Promise<{ emailsProcessed: number; invoicesFound: number }> {
  const imap = createImapConnection(account);
  let emailsProcessed = 0;
  let invoicesFound = 0;
  
  try {
    await connectImap(imap);
    await openInbox(imap);
    
    const parsedDateFrom = dateFrom ? new Date(dateFrom) : undefined;
    const parsedDateTo = dateTo ? new Date(dateTo) : undefined;
    
    const uids = await searchEmails(
      imap,
      parsedDateFrom,
      parsedDateTo,
      account.last_processed_uid || undefined
    );
    
    console.log(`Found ${uids.length} emails to process for ${account.email}`);
    
    await updateSyncLog(syncLogId, {
      total_emails_to_process: uids.length,
    });
    
    for (const uid of uids) {
      if (syncState?.cancelled) break;
      
      try {
        const email = await fetchEmail(imap, uid);
        emailsProcessed++;
        
        if (!email) continue;
        
        // Check exclusion rules
        if (shouldSkipEmail(email, rules)) {
          console.log(`Skipping email "${email.subject}" due to exclusion rule`);
          continue;
        }
        
        // Process PDF attachments
        for (const attachment of email.attachments) {
          const isDuplicate = await checkDuplicateInvoice(
            account.id,
            email.messageId,
            attachment.filename
          );
          
          if (isDuplicate) {
            console.log(`Skipping duplicate: ${attachment.filename}`);
            continue;
          }
          
          // Upload to storage
          const filePath = `${account.id}/${uuidv4()}/${attachment.filename}`;
          await uploadToStorage(
            'invoices',
            filePath,
            attachment.content,
            attachment.contentType
          );
          
          // Insert invoice record
          await insertInvoice({
            email_account_id: account.id,
            filename: attachment.filename,
            file_path: filePath,
            file_size: attachment.size,
            email_subject: email.subject,
            email_from: email.from,
            email_date: email.date.toISOString(),
            email_message_id: email.messageId,
            vendor: extractVendor(email.from),
            amount: null,
            tags: [],
            source_type: 'attachment',
          });
          
          invoicesFound++;
          console.log(`Saved invoice: ${attachment.filename}`);
        }
        
        // Save invoice links for manual download
        for (const link of email.invoiceLinks) {
          await insertPendingLink({
            emailAccountId: account.id,
            detectedUrl: link.url,
            detectedAmount: link.amount,
            emailSubject: email.subject,
            emailFrom: email.from,
            emailDate: email.date.toISOString(),
            emailMessageId: email.messageId,
          });
        }
        
        // Update last processed UID
        await updateAccountLastUid(account.id, uid);
        
        // Update progress periodically
        if (emailsProcessed % 10 === 0) {
          await updateSyncLog(syncLogId, {
            emails_processed_so_far: emailsProcessed,
            total_invoices: invoicesFound,
          });
        }
      } catch (emailErr) {
        console.error(`Error processing email UID ${uid}:`, emailErr);
      }
    }
  } finally {
    disconnectImap(imap);
  }
  
  return { emailsProcessed, invoicesFound };
}

function shouldSkipEmail(email: ProcessedEmail, rules: SyncRule[]): boolean {
  for (const rule of rules) {
    if (rule.rule_type !== 'exclude') continue;
    
    const value = rule.condition_value.toLowerCase();
    
    switch (rule.condition_type) {
      case 'sender_contains':
        if (email.from.toLowerCase().includes(value)) return true;
        break;
      case 'sender_equals':
        if (email.from.toLowerCase() === value) return true;
        break;
      case 'subject_contains':
        if (email.subject.toLowerCase().includes(value)) return true;
        break;
      case 'subject_equals':
        if (email.subject.toLowerCase() === value) return true;
        break;
      case 'domain_equals':
        const domain = email.from.match(/@([^>]+)/)?.[1]?.toLowerCase();
        if (domain === value) return true;
        break;
    }
  }
  
  return false;
}

function extractVendor(from: string): string | null {
  // Try to extract company name from email
  const nameMatch = from.match(/^([^<]+)/);
  if (nameMatch) {
    return nameMatch[1].trim().replace(/["']/g, '');
  }
  
  // Fall back to domain
  const domainMatch = from.match(/@([^.>]+)/);
  if (domainMatch) {
    return domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
  }
  
  return null;
}
