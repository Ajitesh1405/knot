import { Injectable, Logger } from '@nestjs/common';
import {
  SystemMessage,
  HumanMessage,
  ToolMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { LlmService } from 'src/llm/llm.service';

const TZ = process.env.TZ_DISPLAY ?? 'Asia/Kolkata';
const DEFAULT_CITY = process.env.DEFAULT_CITY ?? 'Delhi';

// Handles small talk + simple real-world questions (date, weather) using the
// small/cheap 'chat' model tier with a couple of basic tools.
@Injectable()
export class ChatSpecialist {
  private readonly logger = new Logger(ChatSpecialist.name);
  private readonly model: any; // chat model with tools bound
  private readonly tools: DynamicStructuredTool[];
  private readonly toolMap: Record<string, DynamicStructuredTool>;

  constructor(private readonly llm: LlmService) {
    this.tools = [this.weatherTool()];
    this.toolMap = Object.fromEntries(this.tools.map((t) => [t.name, t]));
    // bindTools lets the small chat model decide when to call a tool.
    this.model = (this.llm.build('chat') as any).bindTools(this.tools);
  }

  async run(
    _userId: string,
    message: string,
    conversation = '',
  ): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt(conversation)),
      new HumanMessage(message),
    ];

    // Tool-calling loop (capped so it can't spin).
    for (let i = 0; i < 3; i++) {
      const res: any = await this.model.invoke(messages);
      const calls = res.tool_calls ?? [];
      if (calls.length === 0) {
        return (
          (typeof res.content === 'string'
            ? res.content
            : String(res.content)) || '🙂'
        );
      }
      messages.push(res); // the assistant turn that requested the tool(s)
      for (const call of calls) {
        const tool = this.toolMap[call.name];
        let output = `Unknown tool: ${call.name}`;
        if (tool) {
          try {
            output = await tool.func(call.args);
          } catch (err: any) {
            output = `Tool error: ${err.message}`;
          }
        }
        messages.push(
          new ToolMessage({ content: output, tool_call_id: call.id ?? call.name }),
        );
      }
    }
    return "Sorry, I couldn't work that out just now.";
  }

  // Inject "now" + recent conversation so the model is grounded and can
  // follow references ("the same person", "what I just asked").
  private systemPrompt(conversation: string): string {
    const now = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date());
    const convoBlock =
      conversation && conversation !== '(no prior messages)'
        ? `\nRecent conversation (for context — resolve references from it):\n${conversation}\n`
        : '';
    return (
      'You are Knot, a warm, concise personal assistant on Telegram. ' +
      'Chat naturally — one or two short sentences, light emoji ok, no markdown headers or lists.\n' +
      `The current date and time is ${now} (${TZ}). Use this for any date/time question — never guess.\n` +
      'You have a get_weather tool — call it for weather questions.\n' +
      convoBlock +
      'If asked what you can do, briefly mention: reading Gmail/Outlook, drafting & ' +
      'sending email replies (with approval), reading the calendar and briefing ' +
      'meetings, scheduling meetings, and remembering facts about people.\n' +
      'Be friendly and human. Do not invent actions you just took.'
    );
  }

  // ─── Basic weather tool via Open-Meteo (no API key needed) ──────────
  private weatherTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'get_weather',
      description:
        'Get the current weather for a city. Use when the user asks about weather.',
      schema: z.object({
        location: z
          .string()
          .optional()
          .describe(`City name; defaults to ${DEFAULT_CITY} if not given.`),
      }),
      func: async ({ location }) => {
        const city = (location && location.trim()) || DEFAULT_CITY;
        // 1) Geocode the city → lat/lon.
        const geo: any = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
            city,
          )}&count=1`,
        ).then((r) => r.json());
        const place = geo.results?.[0];
        if (!place) return `I couldn't find a place called "${city}".`;
        // 2) Current conditions.
        const wx: any = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
            `&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,` +
            `weather_code,wind_speed_10m`,
        ).then((r) => r.json());
        const c = wx.current ?? {};
        return JSON.stringify({
          city: `${place.name}, ${place.country ?? ''}`.trim(),
          temperature_c: c.temperature_2m,
          feels_like_c: c.apparent_temperature,
          wind_kmh: c.wind_speed_10m,
          condition: weatherCodeText(c.weather_code),
        });
      },
    });
  }
}

// WMO weather codes → short text.
function weatherCodeText(code: number): string {
  const m: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'drizzle',
    55: 'dense drizzle',
    61: 'light rain',
    63: 'rain',
    65: 'heavy rain',
    71: 'light snow',
    73: 'snow',
    75: 'heavy snow',
    80: 'rain showers',
    81: 'rain showers',
    82: 'violent rain showers',
    95: 'thunderstorm',
    96: 'thunderstorm with hail',
    99: 'thunderstorm with heavy hail',
  };
  return m[code] ?? 'unknown';
}
