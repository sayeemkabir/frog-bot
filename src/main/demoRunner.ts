import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { TurnRequest, TurnRunner, TurnSink } from '../core/runner';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/**
 * A pretend brain for the self-test: plays a short, realistic teamwork scene
 * (steps, a hand-off, an approval, a plan) using the real team tools and the
 * real approval gate, without calling any AI service.
 */
export class DemoRunner implements TurnRunner {
  async run(req: TurnRequest, sink: TurnSink) {
    sink.session(`demo-${req.agentId}`);
    const frog = req.mcpServers.frog as unknown as { instance: { connect(t: unknown): Promise<void> } };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await frog.instance.connect(serverSide);
    const client = new Client({ name: 'demo', version: '1' });
    await client.connect(clientSide);
    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return (r.content as { text: string }[]).map((c) => c.text).join('');
    };
    const step = async (id: string, name: string, input: Record<string, unknown>, ms = 1400) => {
      sink.tool(id, name, input);
      await sleep(ms, req.abort.signal);
      sink.toolResult(id, 'ok', false);
    };
    const say = async (text: string) => {
      for (const word of text.split(/(?<= )/)) {
        sink.textDelta(word);
        await sleep(25, req.abort.signal);
      }
      sink.textDone(text);
    };
    try {
      const p = req.prompt.toLowerCase();
      if (req.agentName === 'Dog') {
        await step('d1', 'WebSearch', { query: 'Programming with Mosh Python video' }, 2500);
        await step('d2', 'mcp__browser__browser_navigate', { url: 'https://www.youtube.com/watch?v=_uQrJ0TkZlc' }, 2500);
        const verdict = await req.canUseTool('PowerShell', { command: 'yt-dlp --list-subs https://www.youtube.com/watch?v=_uQrJ0TkZlc' }, { signal: req.abort.signal } as never);
        await say(verdict?.behavior === 'allow' ? 'Done: the 2:00–3:00 transcript is saved in the shared folder.' : 'Okay, I will not run that.');
      } else if (p.includes('plan')) {
        await step('p1', 'Read', { file_path: 'notes.md' }, 800);
        await say('Here is my plan:\n\n1. Find the video and its captions\n2. Cut 2:00–3:00\n3. Save the transcript to the shared folder');
      } else if (p.includes('dog')) {
        await step('f1', 'Read', { file_path: 'shared/brief.md' }, 1800);
        await say('On it. I will ask Dog to handle the transcript.');
        await tool('message_agent', { to: 'Dog', message: 'Please transcribe 2:00–3:00 of the Mosh Python video and save it to the shared folder.' });
        await step('f2', 'mcp__browser__browser_snapshot', {}, 9000);
      } else {
        await step('x1', 'Read', { file_path: 'memory.md' }, 600);
        await say('Hi! I am Frog. Tell me what you need and I will get the team on it.');
      }
      sink.done({ ok: !req.abort.signal.aborted, costUsd: 0, tokens: 0, error: req.abort.signal.aborted ? 'Stopped' : undefined });
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
