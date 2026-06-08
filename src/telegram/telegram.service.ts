import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { AgentService } from '../agent/agent.service';
import { SettingsService } from '../settings/settings.service';
import { GmailService } from '../gmail/gmail.service';
import { ComposeHitlService, HitlOutcome } from '../agent/compose-hitl.service';
import { ComposeInterrupt } from '../agent/compose.graph';
import { CalendarService } from '../calendar/calendar.service';
import { OutlookService } from '../outlook/outlook.service';
import { BriefingService } from '../calendar/briefing.service';
import { BriefingScheduler } from '../calendar/briefing.scheduler';
import { CalendarSpecialist } from '../agent/calendar.specialist';
import {
  SchedulerHitlService,
  SchedulerEvent,
} from '../agent/scheduler-hitl.service';

// In edit mode, only treat the message as "cancel" when it's essentially
// JUST an abort word — NOT any sentence containing "don't" (e.g. "don't
// mention the price" is an edit, not a cancel).
function isCancelIntent(text: string): boolean {
  return /^\s*(cancel|never ?mind|nvm|stop|abort|discard|forget it|drop it|scrap( it)?)\s*[.!]?\s*$/i.test(
    text,
  );
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot!: TelegramBot;

  constructor(
    private readonly agent: AgentService,
    private readonly settings: SettingsService,
    private readonly gmail: GmailService,
    private readonly hitl: ComposeHitlService,
    private readonly calendar: CalendarService,
    private readonly briefing: BriefingService,
    private readonly calendarSpec: CalendarSpecialist,
    private readonly scheduler: SchedulerHitlService,
    private readonly outlook: OutlookService,
    private readonly briefingScheduler: BriefingScheduler,
  ) {}

  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram disabled');
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });

    // ─── Notify the user when a pending draft auto-expires (1h) ──
    this.hitl.expired$.subscribe(({ chatId, recipient }) => {
      if (!chatId) return;
      this.bot
        .sendMessage(chatId, `⌛ Draft to ${recipient || 'recipient'} expired.`)
        .catch(() => {});
    });

    // ─── Scheduler HITL events (async approval cards & outcomes) ──
    this.scheduler.events$.subscribe((ev) => void this.onSchedulerEvent(ev));

    // ─── Compose HITL events (NL-triggered draft cards) ──────────
    this.hitl.events$.subscribe(({ chatId, outcome }) => {
      void this.presentOutcome(chatId, outcome);
    });

    // ─── Proactive meeting briefings (cron → Telegram push) ──────
    this.briefingScheduler.briefing$.subscribe(({ userId, text }) => {
      const chatId = userId.startsWith('tg-') ? userId.slice(3) : userId;
      this.bot.sendMessage(chatId, text).catch(() => {});
    });

    // ─── /draft <instruction> — TEMP isolation harness for HITL ──
    // (Phase 3 will route this through the supervisor instead.)
    this.bot.onText(/^\/draft\s+([\s\S]+)$/, async (msg, match) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = String(msg.chat.id);
      const outcome = await this.hitl.start(userId, chatId, match![1].trim());
      await this.presentOutcome(chatId, outcome);
    });

    // ─── /pending — list drafts awaiting approval ───────────────
    this.bot.onText(/^\/pending$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = String(msg.chat.id);
      const drafts = await this.hitl.listPending(userId);
      if (drafts.length === 0) {
        await this.bot.sendMessage(chatId, 'No drafts awaiting approval. ✅');
        return;
      }
      await this.bot.sendMessage(chatId, `📝 ${drafts.length} pending:`);
      for (const d of drafts) {
        const age = this.ageOf(d.createdAt);
        const payload = await this.hitl.currentInterrupt(d.id);
        if (payload) {
          await this.presentInterrupt(chatId, d.id, payload, `(${age} old)`);
        } else {
          await this.bot.sendMessage(
            chatId,
            `• ${d.recipient || '?'} — ${d.subject || '(no subject)'} — ${age} old`,
          );
        }
      }
    });

    // ─── /graph — open the live knowledge graph as a Mini App ───
    this.bot.onText(/^\/graph$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = msg.chat.id;
      const base = process.env.PUBLIC_URL;
      if (!base) {
        await this.bot.sendMessage(
          chatId,
          '⚠️ PUBLIC_URL not set. Add your https tunnel (e.g. ngrok) to .env.',
        );
        return;
      }
      // Telegram Mini Apps require https; the page reads ?userId to scope it.
      const url = `${base.replace(/\/$/, '')}/viz.html?userId=${encodeURIComponent(userId)}`;
      await this.bot.sendMessage(chatId, '🧠 Your knowledge graph:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open graph', web_app: { url } }]],
        },
      });
    });

    // ─── /connect_calendar — same consent URL (calendar scope added) ─
    this.bot.onText(/^\/connect_calendar$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const url = this.gmail.getAuthUrl(userId);
      await this.bot.sendMessage(
        msg.chat.id,
        '🔗 Click to grant Calendar access (same Google account as Gmail):\n\n' +
          url +
          '\n\nApprove on Google — this also covers Gmail.',
        { disable_web_page_preview: true },
      );
    });

    // ─── /meetings today | tomorrow | this_week ─────────────────
    this.bot.onText(
      /^\/meetings (today|tomorrow|this_week|week)$/,
      async (msg, match) => {
        const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
        const chatId = msg.chat.id;
        const range = (
          match![1] === 'week' ? 'this_week' : match![1]
        ) as 'today' | 'tomorrow' | 'this_week';
        await this.bot.sendChatAction(chatId, 'typing');
        const reply = await this.calendarSpec.run(userId, msg.text ?? '', {
          timeRange: range,
        });
        await this.bot.sendMessage(chatId, reply);
      },
    );

    // ─── /next meeting — show the next one + an auto-briefing ────
    this.bot.onText(/^\/next[ _]meeting$/i, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = msg.chat.id;
      await this.bot.sendChatAction(chatId, 'typing');
      try {
        await this.bot.sendMessage(
          chatId,
          await this.briefing.briefUpcoming(userId),
        );
      } catch (err: any) {
        await this.bot.sendMessage(chatId, `❌ ${err.message}`);
      }
    });

    // ─── /briefings on | off | test ─────────────────────────────
    this.bot.onText(/^\/briefings (on|off|test)$/, async (msg, match) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = msg.chat.id;
      const arg = match![1];
      if (arg === 'on') {
        await this.settings.setBriefings(userId, true);
        await this.bot.sendMessage(
          chatId,
          '🔔 Briefings on — I’ll ping you ~30 min before meetings.',
        );
      } else if (arg === 'off') {
        await this.settings.setBriefings(userId, false);
        await this.bot.sendMessage(chatId, '🔕 Briefings off.');
      } else {
        // test: brief the next upcoming meeting right now
        await this.bot.sendChatAction(chatId, 'typing');
        try {
          await this.bot.sendMessage(
            chatId,
            await this.briefing.briefUpcoming(userId),
          );
        } catch (err: any) {
          await this.bot.sendMessage(chatId, `❌ ${err.message}`);
        }
      }
    });

    // ─── /connect_outlook — Microsoft OAuth ─────────────────────
    this.bot.onText(/^\/connect_outlook$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      if (!process.env.MS_CLIENT_ID) {
        await this.bot.sendMessage(
          msg.chat.id,
          '⚠️ Outlook not configured. Set MS_CLIENT_ID / MS_CLIENT_SECRET / MS_REDIRECT_URI in .env.',
        );
        return;
      }
      const url = this.outlook.getAuthUrl(userId);
      await this.bot.sendMessage(
        msg.chat.id,
        '🔗 Click to connect your Outlook / Microsoft account:\n\n' + url,
        { disable_web_page_preview: true },
      );
    });

    // ─── /disconnect_outlook ────────────────────────────────────
    this.bot.onText(/^\/disconnect_outlook$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      await this.outlook.disconnect(userId);
      await this.bot.sendMessage(msg.chat.id, '✓ Outlook disconnected.');
    });

    // ─── /schedule <instruction> — kick off the HITL scheduler ──
    this.bot.onText(/^\/schedule\s+([\s\S]+)$/, async (msg, match) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const ack = await this.scheduler.start(userId, match![1].trim());
      await this.bot.sendMessage(msg.chat.id, ack); // card arrives via events$
    });

    // ─── Inline button presses ──────────────────────────────────
    // 'c|…' = compose, 'm|…' = scheduler.
    this.bot.on('callback_query', (q) => {
      if ((q.data ?? '').startsWith('m|')) void this.onSchedulerCallback(q);
      else void this.onCallback(q);
    });

    // ─── /start ────────────────────────────────────────────────
    this.bot.onText(/^\/start$/, (msg) => {
      this.bot.sendMessage(
        msg.chat.id,
        "👋 I'm your personal knowledge agent.\n\n" +
          "Just talk to me — I'll figure out what to do.\n\n" +
          'Commands:\n' +
          '  /connect_gmail — link your Gmail\n' +
          '  /connect_calendar — grant Calendar access\n' +
          '  /connect_outlook — link Outlook / Microsoft\n' +
          '  /disconnect_gmail — unlink it\n' +
          '  /meetings today | tomorrow — your schedule\n' +
          '  /next meeting — next meeting + briefing\n' +
          '  /schedule <who + when> — set up a meeting\n' +
          '  /briefings on | off | test — pre-meeting pings\n' +
          '  /graph — open your knowledge graph\n' +
          '  /settings — show settings\n' +
          '  /scope personal | everything\n' +
          '  /range new | 30 | year | all',
      );
    });
    // ─── /settings ─────────────────────────────────────────────
    this.bot.onText(/^\/settings$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const s = await this.settings.get(userId);
      await this.bot.sendMessage(
        msg.chat.id,
        `⚙️ Settings\n` +
          `  scope: ${s.scope}\n` +
          `  email range: ${s.emailRange}`,
      );
    });

    // ─── /scope <value> ────────────────────────────────────────
    this.bot.onText(/^\/scope (personal|everything)$/, async (msg, match) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const scope = match![1] as 'personal' | 'everything';
      await this.settings.setScope(userId, scope);
      await this.bot.sendMessage(msg.chat.id, `✓ scope set to: ${scope}`);
    });

    // ─── /range <value> ────────────────────────────────────────
    const rangeMap: Record<
      string,
      'new_only' | 'last_30_days' | 'last_year' | 'all'
    > = {
      new: 'new_only',
      '30': 'last_30_days',
      year: 'last_year',
      all: 'all',
    };
    this.bot.onText(/^\/range (new|30|year|all)$/, async (msg, match) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const range = rangeMap[match![1]];
      await this.settings.setRange(userId, range);
      await this.bot.sendMessage(msg.chat.id, `✓ email range set to: ${range}`);
    });

    // ─── any other message → supervisor handles it ─────────────
    this.bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;

      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const chatId = String(msg.chat.id);
      this.logger.log(`📩 from ${userId}: ${msg.text}`);

      // Scheduler waiting for an attendee's email address?
      const needEmail = await this.scheduler.findAwaitingEmail(userId);
      if (needEmail) {
        await this.bot.sendChatAction(chatId, 'typing');
        await this.scheduler.provideEmail(needEmail.id, msg.text);
        return; // card arrives via events$
      }

      // Scheduler waiting for time-change feedback?
      const schedEdit = await this.scheduler.findAwaitingEdit(userId);
      if (schedEdit) {
        await this.bot.sendChatAction(chatId, 'typing');
        if (isCancelIntent(msg.text)) {
          await this.scheduler.cancel(schedEdit.id); // "don't schedule" → abort
        } else {
          await this.scheduler.applyEdit(schedEdit.id, msg.text);
        }
        return; // outcome/card arrives via events$
      }

      // If a draft is awaiting an edit instruction, treat this text as the
      // correction and resume the HITL graph instead of the agent.
      const editing = await this.hitl.findAwaitingEdit(userId);
      if (editing) {
        await this.bot.sendChatAction(chatId, 'typing');
        const text = msg.text;
        let outcome: HitlOutcome;
        if (isCancelIntent(text)) {
          outcome = await this.hitl.cancel(editing.id);
        } else if (/^ai:/i.test(text)) {
          // "ai: make it shorter" → let the model revise.
          outcome = await this.hitl.applyEdit(editing.id, text.replace(/^ai:/i, '').trim());
        } else {
          // Default: use the user's text verbatim as the email body.
          outcome = await this.hitl.replaceBody(editing.id, text);
        }
        await this.presentOutcome(chatId, outcome);
        return;
      }

      // Show "typing..." while the agent thinks
      await this.bot.sendChatAction(msg.chat.id, 'typing');

      // Telegram's typing indicator auto-clears after ~5 seconds.
      // For longer agent runs, keep poking it every 4 seconds:
      const typingInterval = setInterval(() => {
        this.bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
      }, 4000);

      try {
        const answer = await this.agent.handle(userId, msg.text);
        clearInterval(typingInterval); // ← stop typing
        await this.bot.sendMessage(msg.chat.id, answer);
      } catch (err: any) {
        clearInterval(typingInterval);
        await this.bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
      }
    });

    this.bot.onText(/^\/connect_gmail$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      const url = this.gmail.getAuthUrl(userId);
      await this.bot.sendMessage(
        msg.chat.id,
        '🔗 Click to connect your Gmail:\n\n' +
          url +
          '\n\n' +
          "Approve on Google. The page will confirm when it's done.",
        { disable_web_page_preview: true }, // don't unfurl the long URL
      );
    });

    // ─── /disconnect_gmail ─────────────────────────────────────────
    this.bot.onText(/^\/disconnect_gmail$/, async (msg) => {
      const userId = `tg-${msg.from?.id ?? msg.chat.id}`;
      await this.settings.disconnectGmail(userId);
      await this.bot.sendMessage(msg.chat.id, '✓ Gmail disconnected.');
    });

    this.logger.log('Telegram bot started (polling mode)');
  }

  // ─── HITL presentation helpers ──────────────────────────────────────

  // Handle an Approve / Edit / Cancel / sender-choice button press.
  private async onCallback(q: TelegramBot.CallbackQuery) {
    const data = q.data ?? '';
    const chatId = q.message?.chat.id;
    const messageId = q.message?.message_id;
    if (!chatId || !messageId) return;

    // Format: "c|<draftId>|<action>"  where action = approve|edit|cancel|s<idx>
    const [tag, draftId, action] = data.split('|');
    if (tag !== 'c' || !draftId || !action) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }

    try {
      if (action === 'edit') {
        await this.hitl.markAwaitingEdit(draftId);
        await this.bot.answerCallbackQuery(q.id, { text: '✏️ Edit mode' });
        await this.bot.editMessageText(
          '✏️ Edit mode. Reply with the FULL message you want — I’ll send it ' +
            'exactly as written. Or start with "ai:" to have me revise ' +
            '(e.g. "ai: make it shorter"). Send "cancel" to abort.',
          { chat_id: chatId, message_id: messageId },
        );
        // Send the current body on its own so it's easy to copy, tweak, resend.
        const intr = await this.hitl.currentInterrupt(draftId);
        if (intr && intr.kind === 'approve') {
          await this.bot.sendMessage(chatId, intr.draft.body);
        }
        return;
      }

      await this.bot.answerCallbackQuery(q.id, { text: 'Working…' });
      let outcome: HitlOutcome;
      if (action === 'approve') outcome = await this.hitl.approve(draftId);
      else if (action === 'cancel') outcome = await this.hitl.cancel(draftId);
      else if (action.startsWith('s'))
        outcome = await this.hitl.chooseSender(draftId, Number(action.slice(1)));
      else return;

      // Edit the existing message in place with the new state.
      await this.presentOutcome(String(chatId), outcome, messageId);
    } catch (err: any) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      await this.bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  }

  // Render a HitlOutcome — either a new message or an in-place edit.
  private async presentOutcome(
    chatId: string,
    outcome: HitlOutcome,
    editMessageId?: number,
  ) {
    if (outcome.type === 'interrupt') {
      await this.presentInterrupt(
        chatId,
        outcome.draftId,
        outcome.payload,
        undefined,
        editMessageId,
      );
      return;
    }

    const text =
      outcome.type === 'error'
        ? `❌ ${outcome.message}`
        : outcome.status === 'sent'
          ? `✅ Sent to ${outcome.recipient}.`
          : outcome.status === 'cancelled'
            ? '❌ Draft cancelled.'
            : outcome.status === 'no_match'
              ? `🤔 I couldn't find a recent email from "${outcome.recipient}" to reply to.`
              : `Draft ${outcome.status}.`;

    if (editMessageId) {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: editMessageId,
      });
    } else {
      await this.bot.sendMessage(chatId, text);
    }
  }

  // Render an interrupt (approval gate or sender disambiguation) + buttons.
  private async presentInterrupt(
    chatId: string,
    draftId: string,
    payload: ComposeInterrupt,
    suffix?: string,
    editMessageId?: number,
  ) {
    let text: string;
    let keyboard: TelegramBot.InlineKeyboardButton[][];

    if (payload.kind === 'choose_sender') {
      text =
        `Found ${payload.candidates.length} matches for "${payload.recipient}" — which one?` +
        (suffix ? `\n${suffix}` : '');
      keyboard = payload.candidates.map((c) => [
        { text: c.address, callback_data: `c|${draftId}|s${c.index}` },
      ]);
    } else {
      const d = payload.draft;
      text =
        `📤 Draft to ${d.recipientName}\n` +
        `Subject: ${d.subject}\n\n` +
        `${d.body}` +
        (suffix ? `\n\n${suffix}` : '');
      keyboard = [
        [
          { text: '✅ Approve', callback_data: `c|${draftId}|approve` },
          { text: '✏️ Edit', callback_data: `c|${draftId}|edit` },
          { text: '❌ Cancel', callback_data: `c|${draftId}|cancel` },
        ],
      ];
    }

    const opts = { reply_markup: { inline_keyboard: keyboard } };
    if (editMessageId) {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: editMessageId,
        reply_markup: opts.reply_markup,
      });
    } else {
      const sent = await this.bot.sendMessage(chatId, text, opts);
      await this.hitl.attachMessage(
        draftId,
        chatId,
        String(sent.message_id),
      );
    }
  }

  // Human-readable age, e.g. "12m", "2h".
  private ageOf(created: Date): string {
    const mins = Math.floor((Date.now() - created.getTime()) / 60000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  }

  // ─── Scheduler HITL: button presses ─────────────────────────────────
  private async onSchedulerCallback(q: TelegramBot.CallbackQuery) {
    const chatId = q.message?.chat.id;
    const messageId = q.message?.message_id;
    const [tag, draftId, action] = (q.data ?? '').split('|');
    if (tag !== 'm' || !draftId || !action || !chatId || !messageId) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }
    try {
      if (action === 'edit') {
        await this.scheduler.markAwaitingEdit(draftId);
        await this.bot.answerCallbackQuery(q.id, { text: '✏️ Edit mode' });
        await this.bot.editMessageText(
          "✏️ What should change? e.g. \"make it 1 hour\", \"try Thursday morning\".",
          { chat_id: chatId, message_id: messageId },
        );
        return;
      }
      if (action === 'send') {
        await this.bot.answerCallbackQuery(q.id, { text: 'Sending…' });
        await this.bot.editMessageText('⏳ Scheduling & sending invites…', {
          chat_id: chatId,
          message_id: messageId,
        });
        await this.scheduler.approve(draftId); // outcome via events$
        return;
      }
      if (action === 'cancel') {
        await this.bot.answerCallbackQuery(q.id, { text: 'Cancelled' });
        await this.scheduler.cancel(draftId);
        return;
      }
    } catch (err: any) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      await this.bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  }

  // ─── Scheduler HITL: async events (cards + outcomes) ────────────────
  private async onSchedulerEvent(ev: SchedulerEvent) {
    const chatId = ev.chatId;
    const ref = await this.scheduler.getDraftRef(ev.draftId);
    const messageId = ref?.messageId ? Number(ref.messageId) : undefined;

    if (ev.kind === 'interrupt') {
      if (ev.payload.kind === 'need_email') {
        const names = ev.payload.names.join(', ');
        await this.bot.sendMessage(
          chatId,
          `🤔 I don't have an email for ${names}. Reply with their address` +
            (ev.payload.names.length > 1 ? 'es (in that order).' : '.'),
        );
        return;
      }
      // approve_meeting → card with buttons
      const p = ev.payload.proposal;
      const text =
        `📅 Propose: ${p.summary}\n` +
        `🕐 ${ev.payload.startLabel} (${ev.payload.durationMins} min)\n` +
        `👥 ${p.attendeeLabels.join(', ')}\n` +
        `🔗 Google Meet link added on send`;
      const keyboard = [
        [
          { text: '✅ Send invite', callback_data: `m|${ev.draftId}|send` },
          { text: '✏️ Change time', callback_data: `m|${ev.draftId}|edit` },
          { text: '❌ Cancel', callback_data: `m|${ev.draftId}|cancel` },
        ],
      ];
      const markup = { inline_keyboard: keyboard };
      if (messageId) {
        await this.bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: markup,
        });
      } else {
        const sent = await this.bot.sendMessage(chatId, text, {
          reply_markup: markup,
        });
        await this.scheduler.attachMessage(
          ev.draftId,
          String(chatId),
          String(sent.message_id),
        );
      }
      return;
    }

    if (ev.kind === 'error') {
      await this.sendOrEdit(chatId, messageId, `❌ ${ev.message}`);
      return;
    }

    // ev.kind === 'done'
    const text =
      ev.status === 'scheduled'
        ? `✅ Scheduled for ${ev.startLabel} — invites sent.` +
          (ev.meetLink ? `\nMeet: ${ev.meetLink}` : '')
        : ev.status === 'cancelled'
          ? '❌ Meeting cancelled.'
          : ev.status === 'no_slot'
            ? '😕 No free slot worked for everyone in that window. Try a different time.'
            : ev.status === 'no_attendees'
              ? '🤔 Who should I invite? Try: "schedule 30 min with <name> tomorrow".'
              : `Scheduler: ${ev.status}.`;
    await this.sendOrEdit(chatId, messageId, text);
  }

  private async sendOrEdit(
    chatId: number | string,
    messageId: number | undefined,
    text: string,
  ) {
    if (messageId) {
      await this.bot
        .editMessageText(text, { chat_id: chatId, message_id: messageId })
        .catch(() => this.bot.sendMessage(chatId, text));
    } else {
      await this.bot.sendMessage(chatId, text);
    }
  }

  async onModuleDestroy() {
    if (this.bot) await this.bot.stopPolling();
  }
}
