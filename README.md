# Wedyan

A browser desktop you share with your AI agent. You both use the same apps and the same tools, and the agent works from the apps' real state, not from screenshots.

You say what you want, in words or by voice. The agent answers in structured data: text to show, text to speak, widgets, and actions on the desktop, timed to what it is saying.

> Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Work in progress.

## Why

Most agents that operate software look at pixels and guess. Every app already knows its own facts: what is open, what is selected, what a button does. Wedyan gives the agent those facts as data, and gives it the same buttons as tools. So the agent acts on what is true, the user can see and undo what it did, and nothing has to be generated as code when a tool already exists.

## How an ask works

One ask is one streaming call. Everything happens inside it:

- **Routing.** A fast router model answers simple asks itself or hands off to a specialist agent. A handoff passes a brief and what is already known, not the previous agent's reasoning.
- **Answer.** The model writes Markdown with a few markers: `[[say]]` for what to speak, `[[widget]]` for UI as data, and `[[action]]` for something to do at that point in the answer. The kernel turns this into parts (text and widgets) that stream to the desktop.
- **Actions.** Actions run on the desktop in order, each when the words before it have been shown or spoken. A failure is reported back to the model, which adjusts.
- **Questions both ways.** The agent can ask the desktop for state or ask the user a question mid-task; the user can add a follow-up or say "never mind" while the agent works. Both go over the same live call.
- **Tools.** System calls (files, memory) run on the server; app calls are answered by the app that owns the state.

## Built with

- **[AirLib](https://airlib.dev)** (open source, by the same author): reactive state, IRPC (type-safe calls with streaming and two-way ask/answer), r2-file (filesystem on Cloudflare R2 and D1), ai-kit (one API over AI providers), and AUI (the UI component library).
- **Meta models:** Muse Spark for the agents and the router, Muse Voice Transcribe for speech, Muse Image and SAM 3.1 for photos.
- **Open-source models:** BGE-M3 by BAAI (MIT) for the embeddings behind memory and file recall, and MeloTTS by MyShell (MIT) for speaking answers aloud, both on Cloudflare Workers AI.
- **Cloudflare:** Workers, Durable Objects (one per session), R2, D1, Vectorize, Queues.

## What was built during the event

Everything in this repository was written during the event. It builds on AirLib and AUI, open-source libraries that existed before it.

## Project layout

| Path | What it holds |
|---|---|
| `lib/kernel/` | The agent kernel: the ask loop, routing and handoff, the response-format parser, parts and actions. `*.h.ts` files are contracts shared by client and server; the matching `*.ts` files are server-side. |
| `lib/systems/` | Desktop boot, the prompt and commands. |
| `apps/` | The built-in apps (Files, Photos). |
| `components/` | Shared UI components. |
| `pages/`, `src/` | Routes, app entry and the worker. |
| `server/` | Runtime entries (Cloudflare Workers, Bun, Node, Deno). |
| `test/` | Test suites. Only external model APIs are mocked. |

## Development

```bash
bun install
bun run dev
bun run test
```

`bun run dev` serves the desktop on `http://localhost:6173`.

## License

To be decided.
