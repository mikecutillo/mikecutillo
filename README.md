# Hi, I'm Mike Cutillo

**AI systems builder. Enterprise implementation leader. The person organizations call when they need new technology to actually get used.**

I've spent my career at exactly one intersection: cutting-edge technology and the humans who need to use it. I learn things first, build with them, and then help organizations adopt them. That pattern runs from my years as a Microsoft Learning Specialist and three-time Demo Cup Champion, through co-founding an EdTech company from inside a working K-8 school, to independently building and deploying AI workflow platforms for clients today.

I don't just advise on AI — I ship it. The repos here are tools I built for real use, currently running in production. Some of my best work — like **BMO** (our family's live-in Discord AI) and **OpenClaw Trader** (a Claude-augmented paper-trading bot) — runs in private repos on my own infrastructure.

---

## Currently Building

I'm developing a **personal AI operating system** — a unified platform that orchestrates family life, job search, content creation, cloud storage, home infrastructure, and finances through a single local dashboard. The system spans **34+ active projects** across **7 responsibility areas**, all tracked through a structured PARA methodology in Notion.

Active work right now:
- **BMO — Family AI Companion** — A 24/7 Discord bot for my household, running on a capability registry I can extend without redeploying. Kids can DM it for curfew checks, Pulse surveys, homework reminders, and more.
- **OpenClaw Trader** — Python paper-trading bot. Phases 0–5 are rule-based; Phase 6 hands the final decision to Claude. Safe sandbox, no real orders.
- **Mission Control UI** — Dense, data-rich Next.js dashboard with 16+ module pages in various stages of completion
- **One-Click Job Apply** — Playwright automation that fills applications from an AI-powered answer bank
- **Multi-Provider AI Router** — Intelligent waterfall across Claude, OpenAI, Gemini, and OpenRouter with cost-aware fallback
- **Cloud Migration Pipeline** — Multi-account photo deduplication and NAS consolidation across Google, iCloud, and OneDrive

---

## What I Build

### BMO — Family AI Companion (Discord) 🌟
My favorite thing I've ever built. BMO is a 24/7 TypeScript + Discord.js bot that lives in the Cutillo family server and acts as a shared household brain. Everything is driven by a **20-capability registry** with six executor types (scheduled-summary, intent-response, state-watcher, survey, external-api, static-response), so I can add new behaviors by writing a Notion row — no redeploy. Config spans **6 Notion databases** (Capabilities, Channels, People, Personality, Pulse Questions, Incidents), giving me a "One Voice" brand across **21 channels** for the whole family. Runs under `launchd` with auto-restart supervision, integrates Anthropic Claude for natural replies, and exposes a `/bmo` control surface. Kids interact with numbered-option replies for curfew, Pulse check-ins, and chore reminders. *(private repo — runs on my Mac Mini)*

### OpenClaw Trader — AI-Augmented Paper Trading
Personal paper-trading bot written in Python. Phases 0–5 apply rule-based signal generation, position sizing, and risk checks; **Phase 6 hands the final trade decision to Claude** with full market context and journaled reasoning. Zero real orders — purely a sandbox for iterating on Claude-as-decision-maker patterns before any capital ever enters the loop. *(private repo)*

### Mission Control — Personal AI OS
Full-stack Next.js platform that orchestrates job tracking, content pipelines, cloud storage monitoring, and AI-assisted workflows across Claude, OpenAI, and Gemini. Integrates a multi-provider model router, kanban job pipeline, answer bank, Playwright-based automation worker, and the live ops surface for BMO — all from a single local dashboard. *(private repo — component pieces below)*

### [Apply Assistant](https://github.com/mikecutillo/mission-control-apply-assistant) — Chrome Extension
Chrome MV3 extension that bridges the browser and the local pipeline. One click on any job posting scrapes structured metadata (JSON-LD, OG tags, DOM heuristics) and adds it to the kanban. On application forms (LinkedIn, Workday, Greenhouse, Lever, Ashby, iCIMS), it scans every labeled input, resolves answers from the shared AI answer bank, and fills using React-safe native setters. Every unanswered question is logged and becomes a permanent answer once resolved — the system learns.

### [Job Search Automation](https://github.com/mikecutillo/linkedin-job-automation)
Playwright + Selenium automation using Chrome remote debugging session reuse — Easy Apply workflows, fit analysis via 4-lane Claude tailor pipeline, custom resume generation, and zero-interaction apply for known-answer forms.

### [Google Workspace Toolkit](https://github.com/mikecutillo/Google-Workspace-Toolkit)
Python tools for Gmail and Google Drive management across multiple accounts — AI-assisted email analysis powered by Claude, OAuth 2.0 auth, cleanup automation, and Plotly analytics dashboards.

### [Microsoft 365 Dashboard](https://github.com/mikecutillo/m365-streamlit-dashboard)
Streamlit dashboard with Microsoft MSAL authentication for mailbox analysis, OneDrive management, and unified M365 ecosystem visibility.

### [AI Model Router](https://github.com/mikecutillo/ai-model-router)
Multi-provider LLM router with intelligent waterfall fallback (Claude → OpenAI → Gemini → OpenRouter). Built for real operational use — task management, content pipelines, cloud monitoring — deployed for clients with their own tools, identity systems, and workflows.

---

## By the Numbers

| | |
|---|---|
| **Active Projects** | 34+ across family infra, AI, career, content, home ops, and finance |
| **Flagship System** | BMO — a family-wide Discord AI with 20 extensible capabilities |
| **Technologies** | 24+ integrated services and APIs in production |
| **AI Providers** | Claude, OpenAI, Gemini, OpenRouter — multi-provider with fallback |
| **Cloud Integrations** | Gmail, Google Drive, Microsoft Graph, iCloud, Discord, Buffer, Notion |
| **Automation** | Playwright, Selenium, Chrome Extensions, launchd, cron pipelines |

---

## Tech Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)
![Anthropic](https://img.shields.io/badge/Anthropic_Claude-CC785C?style=flat&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat&logo=openai&logoColor=white)
![Google APIs](https://img.shields.io/badge/Google_APIs-4285F4?style=flat&logo=google&logoColor=white)
![Microsoft Graph](https://img.shields.io/badge/Microsoft_Graph-0078D4?style=flat&logo=microsoft&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat&logo=streamlit&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Selenium](https://img.shields.io/badge/Selenium-43B02A?style=flat&logo=selenium&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Discord](https://img.shields.io/badge/Discord.js-5865F2?style=flat&logo=discord&logoColor=white)
![Notion](https://img.shields.io/badge/Notion_API-000000?style=flat&logo=notion&logoColor=white)
![launchd](https://img.shields.io/badge/launchd-000000?style=flat&logo=apple&logoColor=white)

---

## Connect

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/michael-cutillo-aa616a55/)

📍 Holmdel, NJ · Open to AI implementation, solutions architecture, and EdTech roles
