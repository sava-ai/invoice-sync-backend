import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import { EmailAccount, ProcessedEmail, ProcessedAttachment, InvoiceLink } from '../types';

export function createImapConnection(account: EmailAccount): Imap {
  return new Imap({
    user: account.username,
    password: account.password,
    host: account.imap_host,
    port: account.imap_port,
    tls: account.use_ssl,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000,
    connTimeout: 30000,
  });
}

export function searchEmails(
  imap: Imap,
  dateFrom?: Date,
  dateTo?: Date,
  lastUid?: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const criteria: any[] = ['ALL'];
    
    if (dateFrom) {
      criteria.push(['SINCE', dateFrom]);
    }
    if (dateTo) {
      criteria.push(['BEFORE', dateTo]);
    }
    if (lastUid && lastUid > 0) {
      criteria.push(['UID', `${lastUid + 1}:*`]);
    }

    imap.search(criteria, (err, results) => {
      if (err) return reject(err);
      
      // Filter out UIDs <= lastUid (IMAP UID ranges are inclusive)
      const filteredResults = lastUid 
        ? results.filter(uid => uid > lastUid)
        : results;
      
      resolve(filteredResults.sort((a, b) => a - b));
    });
  });
}

export function fetchEmail(imap: Imap, uid: number): Promise<ProcessedEmail | null> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], {
      bodies: '',
      struct: true,
    });

    let emailData: Buffer[] = [];

    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        stream.on('data', (chunk) => {
          emailData.push(chunk);
        });
      });

      msg.once('end', async () => {
        try {
          const fullEmail = Buffer.concat(emailData);
          const parsed = await simpleParser(fullEmail);
          
          // Check if this email might contain invoices
          if (!mightContainInvoice(parsed)) {
            resolve(null);
            return;
          }
          
          const processedEmail = await processEmail(parsed, uid);
          resolve(processedEmail);
        } catch (err) {
          console.error(`Error parsing email UID ${uid}:`, err);
          resolve(null);
        }
      });
    });

    fetch.once('error', (err) => {
      console.error(`Error fetching email UID ${uid}:`, err);
      resolve(null);
    });

    fetch.once('end', () => {
      // Fetch completed
    });
  });
}

function mightContainInvoice(parsed: ParsedMail): boolean {
  const subject = (parsed.subject || '').toLowerCase();
  const from = (parsed.from?.text || '').toLowerCase();
  const text = (parsed.text || '').toLowerCase();
  
  // Check for PDF attachments
  const hasPdfAttachment = parsed.attachments?.some(
    att => att.contentType === 'application/pdf' || 
           att.filename?.toLowerCase().endsWith('.pdf')
  );
  
  if (hasPdfAttachment) return true;
  
  // Check for invoice-related keywords
  const invoiceKeywords = [
    'invoice', 'factura', 'rechnung', 'fattura', 'facture',
    'receipt', 'bill', 'payment', 'order confirmation',
    'your order', 'purchase', 'transaction'
  ];
  
  const hasInvoiceKeyword = invoiceKeywords.some(
    keyword => subject.includes(keyword) || from.includes(keyword)
  );
  
  if (hasInvoiceKeyword) return true;
  
  // Check for invoice links in body
  const invoiceLinkPatterns = [
    /download.*invoice/i,
    /view.*invoice/i,
    /invoice.*pdf/i,
    /get.*receipt/i,
    /download.*receipt/i,
  ];
  
  return invoiceLinkPatterns.some(pattern => pattern.test(text));
}

async function processEmail(parsed: ParsedMail, uid: number): Promise<ProcessedEmail> {
  const attachments: ProcessedAttachment[] = [];
  const invoiceLinks: InvoiceLink[] = [];
  
  // Process PDF attachments
  for (const att of parsed.attachments || []) {
    if (att.contentType === 'application/pdf' || 
        att.filename?.toLowerCase().endsWith('.pdf')) {
      attachments.push({
        filename: att.filename || `attachment-${uid}.pdf`,
        content: att.content,
        contentType: att.contentType,
        size: att.size,
      });
    }
  }
  
  // Find invoice links in HTML/text body
  const htmlBody = parsed.html || '';
  const textBody = parsed.text || '';
  const body = htmlBody + ' ' + textBody;
  
  // Look for invoice download links
  const linkPatterns = [
    /href=["']([^"']*(?:invoice|receipt|download)[^"']*)["']/gi,
    /https?:\/\/[^\s<>"']+(?:invoice|receipt|download|pdf)[^\s<>"']*/gi,
  ];
  
  const foundUrls = new Set<string>();
  for (const pattern of linkPatterns) {
    const matches = body.matchAll(pattern);
    for (const match of matches) {
      const url = match[1] || match[0];
      if (url && !foundUrls.has(url)) {
        foundUrls.add(url);
        invoiceLinks.push({
          url,
          amount: findAmountNearLink(body, url),
        });
      }
    }
  }
  
  return {
    uid,
    subject: parsed.subject || '',
    from: parsed.from?.text || '',
    date: parsed.date || new Date(),
    messageId: parsed.messageId || `${uid}@unknown`,
    attachments,
    invoiceLinks,
  };
}

function findAmountNearLink(body: string, url: string): string | null {
  // Find amounts near the link in the text
  const urlIndex = body.indexOf(url);
  if (urlIndex === -1) return null;
  
  // Look within 500 characters around the link
  const start = Math.max(0, urlIndex - 250);
  const end = Math.min(body.length, urlIndex + url.length + 250);
  const context = body.substring(start, end);
  
  // Match currency amounts
  const amountPatterns = [
    /[\$€£]\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/,
    /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:USD|EUR|GBP|CHF)/,
    /(?:total|amount|sum|price)[\s:]*[\$€£]?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
  ];
  
  for (const pattern of amountPatterns) {
    const match = context.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return null;
}

export function openInbox(imap: Imap): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', true, (err, box) => {
      if (err) return reject(err);
      resolve(box);
    });
  });
}

export function connectImap(imap: Imap): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.once('ready', () => resolve());
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

export function disconnectImap(imap: Imap): void {
  try {
    imap.end();
  } catch (e) {
    // Ignore disconnect errors
  }
}
