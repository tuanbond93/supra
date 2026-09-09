const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Auto-load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

// Configuration
const CONFIG = {
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.IMAP_PORT || '993', 10),
  secure: process.env.IMAP_SECURE !== 'false',
  user: process.env.IMAP_USER || '',
  pass: process.env.IMAP_PASSWORD || '',
  senderKeywords: ['chinhqt@supra.masangroup.com', 'cuongnv3@supra.masangroup.com', 'supra.masangroup.com'],
  subjectKeyword: 'KẾ HOẠCH XUẤT NVT',
};

/**
 * Normalizes text for case-insensitive and diacritic-insensitive comparison
 */
function normalizeText(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Connects to IMAP, searches for the latest plan email from customer,
 * and downloads the attached Excel (.xlsb or .xlsx) file.
 */
async function fetchLatestPlanMail(options = {}) {
  const user = options.user || CONFIG.user;
  const pass = options.pass || CONFIG.pass;
  const host = options.host || CONFIG.host;
  const port = options.port || CONFIG.port;
  const secure = options.secure !== undefined ? options.secure : CONFIG.secure;

  if (!user || !pass) {
    throw new Error(
      'Chưa cấu hình tài khoản Email (IMAP_USER và IMAP_PASSWORD).\n' +
      'Vui lòng cấu hình tài khoản Gmail và Mật khẩu ứng dụng (App Password 16 ký tự) trong biến môi trường hệ thống.'
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = client.mailbox;
      const totalMessages = status.exists;

      if (totalMessages === 0) {
        throw new Error('Hòm thư INBOX trống, không có thư nào.');
      }

      // Fetch the latest 50 messages (from newest to oldest)
      const fetchCount = Math.min(50, totalMessages);
      const startSeq = Math.max(1, totalMessages - fetchCount + 1);
      const range = `${startSeq}:${totalMessages}`;

      const messages = [];
      for await (const message of client.fetch(range, { envelope: true, uid: true, flags: true })) {
        messages.push(message);
      }
      // Sort descending (newest first)
      messages.sort((a, b) => b.uid - a.uid);

      const targetSubjectNorm = normalizeText(process.env.MAIL_SUBJECT_FILTER || CONFIG.subjectKeyword);
      const targetSenderFilter = process.env.MAIL_SENDER_FILTER ? [process.env.MAIL_SENDER_FILTER] : CONFIG.senderKeywords;

      let matchedUid = null;
      let matchedEnvelope = null;
      let matchedFlags = null;

      for (const msg of messages) {
        const env = msg.envelope;
        if (!env) continue;

        const subjectNorm = normalizeText(env.subject);
        const fromAddress = env.from && env.from[0] ? (env.from[0].address || '') : '';
        const fromName = env.from && env.from[0] ? (env.from[0].name || '') : '';
        const fromCombined = normalizeText(`${fromAddress} ${fromName}`);

        // Check if subject matches (e.g. "DCPT KẾ HOẠCH XUẤT NVT...")
        const subjectMatches = subjectNorm.includes(targetSubjectNorm) || 
                               subjectNorm.includes('ke hoach xuat nvt') ||
                               subjectNorm.includes('chot booking');

        // Check if sender matches
        const senderMatches = targetSenderFilter.some(k => fromCombined.includes(normalizeText(k)));

        if (subjectMatches || (senderMatches && subjectNorm.includes('nvt'))) {
          matchedUid = msg.uid;
          matchedEnvelope = env;
          matchedFlags = msg.flags;
          break;
        }
      }

      if (!matchedUid) {
        throw new Error(
          `Không tìm thấy email nào khớp với tiêu đề "${CONFIG.subjectKeyword}" hoặc người gửi từ Supra/Masan trong ${fetchCount} thư gần nhất.`
        );
      }

      const isImapAnswered = matchedFlags && (
        matchedFlags.has('\\Answered') ||
        matchedFlags.has('$suprasynced') ||
        matchedFlags.has('$SupraSynced')
      );

      // Download message source
      let messageSource = null;
      try {
        const messageData = await client.fetchOne(String(matchedUid), { source: true }, { uid: true });
        if (messageData && messageData.source) {
          messageSource = messageData.source;
        }
      } catch (e) {
        console.warn('fetchOne source error, fallback to download...', e.message);
      }

      if (!messageSource) {
        const downloadResult = await client.download(String(matchedUid), undefined, { uid: true });
        if (downloadResult && downloadResult.content) {
          messageSource = downloadResult.content;
        }
      }

      if (!messageSource) {
        throw new Error(`Không thể tải nội dung email (UID: ${matchedUid}). Vui lòng thử lại.`);
      }

      const parsed = await simpleParser(messageSource);

      // Look for Excel attachment (.xlsb or .xlsx)
      const validAttachments = (parsed.attachments || []).filter(att => {
        const fName = (att.filename || '').toLowerCase();
        return fName.endsWith('.xlsb') || fName.endsWith('.xlsx');
      });

      if (validAttachments.length === 0) {
        throw new Error(
          `Tìm thấy email "${parsed.subject}" từ "${parsed.from ? parsed.from.text : ''}", nhưng thư này không có đính kèm file Excel (.xlsb / .xlsx).`
        );
      }

      // Choose the best attachment (prefer one with 'ghn' or date, or the first excel file)
      const targetAttachment = validAttachments.find(att => {
        const fn = att.filename.toLowerCase();
        return fn.includes('ghn') || /\d{6,8}/.test(fn);
      }) || validAttachments[0];

      // Save to temp file
      const tempPath = path.join(os.tmpdir(), targetAttachment.filename);
      fs.writeFileSync(tempPath, targetAttachment.content);

      return {
        success: true,
        filePath: tempPath,
        fileName: targetAttachment.filename,
        emailSubject: parsed.subject,
        emailSender: parsed.from ? parsed.from.text : '',
        emailDate: parsed.date,
        messageId: parsed.messageId || '',
        uid: matchedUid,
        isImapAnswered: !!isImapAnswered,
      };
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch (e) {
      // Ignore logout errors
    }
  }
}

/**
 * Marks an email as processed/answered in IMAP permanently
 */
async function markEmailAnswered(uid) {
  if (!uid) return;
  const user = CONFIG.user;
  const pass = CONFIG.pass;
  if (!user || !pass) return;

  const client = new ImapFlow({
    host: CONFIG.host,
    port: CONFIG.port,
    secure: CONFIG.secure,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(String(uid), ['\\Answered', '$SupraSynced'], { uid: true });
    } finally {
      lock.release();
    }
  } catch (e) {
    console.warn('Error marking email answered in IMAP:', e.message);
  } finally {
    try {
      await client.logout();
    } catch (e) {}
  }
}

module.exports = {
  fetchLatestPlanMail,
  markEmailAnswered,
  CONFIG,
};
