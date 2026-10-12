# Personal Daily / 个人手账

[English](README.md) · [简体中文](README.zh-CN.md)

Switch between **EN / 中** in the top bar. The choice persists across pages and reloads. Interface labels, calendar dates, and untouched built-in examples are available in English and Simplified Chinese. Your own tasks, notes, and recordings remain in the language you wrote them.

A personal workspace for tasks, planning, a daily timeline, reflections, and a Voice Inbox. Built with React, vinext, Cloudflare D1/R2, and Drizzle. Licensed under MIT.

This public starter contains fictional examples. Tasks and planning use the same five areas: **Work, Workout, Relax, Study, and Chores**. Work includes Project Beacon (customer portal), Project Atlas (knowledge base), and Project Willow (launch campaign). Study includes Finance, Word, and Politics. Six of the ten example plans are for work.

History, reviews, schedules, recordings, transcripts, and activity sessions start empty. The journal and history features remain available for your own future activity. No cross-site synchronization is included.

## Set up with AI

Choose one prompt below and paste it into an AI coding assistant that can read GitHub repositories and run setup commands. The prompts already include this project’s GitHub link. The GPT Sites option also requires access to Sites tools in your AI workspace. You do not need to understand the configuration details in the prompts—the assistant will work through them with you.

### Option 1: My own GPT Sites website

```text
Set up my own private Personal Daily / 个人手账 website from this repository:
https://github.com/pexur/Peter-Junior.git

Please carry out the setup, not just describe it. Read the repository's instructions, locate the application root, and use the available Sites skill and supported setup/deployment tools. If Sites tools are unavailable, explain what access is missing and offer local setup instead.

Keep the existing application, its EN / 中 language toggle, tasks, planning boards, timeline, journal, and Voice Inbox. Import this source rather than replacing it with a blank template. Create a new Site in my account with its own project identity and private access. Preserve the vinext/Cloudflare Worker runtime and required Sites build integration; provision my own D1 DB and R2 BUCKET bindings. Replace placeholder resource identifiers through the supported hosting workflow.

Initialize only the new, empty database using drizzle/0000_initial.sql and db/seed.sql. Keep the fictional examples and empty history; do not connect any existing personal database. Follow the README's single-owner authentication requirements, configure my authenticated owner ID, and verify that the trusted gateway protects the Worker before deployment.

Help me configure optional voice features using my own API key through secure runtime settings. If I skip the key, finish the working tasks and planning app and explain how to enable voice later. For iPhone uploads, use a cryptographically secure generator to create my token, configure it as a runtime secret, and give me the actual website URL and connection details privately. Update my private setup instructions, then guide me through the detailed iPhone Shortcut steps. Never put credentials in source or public documentation.

Install dependencies, run the repository's build, tests, lint, and TypeScript checks, and resolve setup issues. Deploy privately using the supported Sites workflow, wait for confirmed success, and check the main pages and both languages. Give me the working URL, a short explanation of how to use and update my site, and any manual steps that still require my account access. Do not claim a step succeeded without checking it.
```

### Option 2: Run on my computer

```text
Set up Personal Daily / 个人手账 locally on my computer from this repository:
https://github.com/pexur/Peter-Junior.git

Please carry out the setup, not just describe it. Clone the repository into a new folder, read its instructions, and locate the application root. Preserve the existing bilingual application and fictional examples.

Check that Node.js 22.13 or newer and npm are available, then run npm ci, npm run db:setup, and npm run dev. Use the project's local D1/R2 emulation and local-dev identity on the loopback interface. Keep the app local; no hosted Site or Cloudflare account is needed for this setup. Initialize only this new checkout's local database and leave any existing installation or data intact.

Tasks and planning should work without an API key. If I want voice features, help me copy .env.example to the ignored .dev.vars file and configure my own key securely, with SHORTCUT_OWNER_ID=local-dev. Keep secrets out of source control and command output. Explain that an iPhone cannot reach my computer through its own localhost address; remote Shortcut uploads need a reachable, authenticated deployment, which can be set up separately.

Run the build, tests, lint, and TypeScript checks and resolve setup issues. Start the development server and verify the main pages, fictional task and planning data, and EN / 中 toggle. Give me the actual local URL, the folder location, how to stop and restart the app, and any optional features still awaiting configuration. Explain remaining manual steps simply and do not claim success for anything you could not verify.
```

## Run locally

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm run db:setup
npm run dev
```

Open the local URL printed by the development server. Development uses the loopback interface and supplies a `local-dev` identity only for loopback requests. The production Worker does not include this development identity.

`db:setup` applies the clean initial schema to a project-local database and loads `db/seed.sql`. The stable sample IDs make setup repeatable without overwriting edits or reviving removed examples. To start without sample content, apply only the migrations; the task list will create its five empty default categories on first use.

For optional voice features, copy `.env.example` to `.dev.vars` and provide your own API key. Use `SHORTCUT_OWNER_ID=local-dev` for local development. Without an API key, tasks and planning still work, and Voice Inbox reports that AI is not configured. Audio processing sends recordings to the configured OpenAI transcription model and transcripts/context to the interpretation model. Changes remain proposals until approved.

```sh
npm run build
node --test tests/*.mjs
npm run lint
npx tsc --noEmit --incremental false
```

## Hosting

The app uses the Cloudflare Workers runtime, with a D1 binding named `DB` and an R2 binding named `BUCKET`. `.openai/hosting.json` declares those bindings without a project identity. `wrangler.jsonc` contains local placeholder resource identifiers. Provision your own resources and configure your host before deployment; do not attach an existing personal database or bucket to a public demo.

This is a **single-owner workspace**. Production expects a trusted authentication gateway to set `oai-authenticated-user-id`, and `SHORTCUT_OWNER_ID` should be set to the permitted account ID. The gateway must remove client-supplied identity headers and prevent bypassing it to reach the Worker. The task and planning tables are not separated by user. If hosting outside that gateway environment, integrate authentication before exposing the app.

Apply `drizzle/0000_initial.sql` to a new database, then run `db/seed.sql` against that database to include the examples. The initial migration replaces the private project's migration chain and is intended for a fresh database. Configure secrets in your hosting runtime, never in committed files. Voice Inbox additionally needs R2 storage and your own API key.

## iPhone Shortcut

Start by asking AI to generate a secure token, configure your website, and update your Shortcut setup instructions:

> Help me set up an iPhone Shortcut for Personal Daily. Generate a secure upload token, configure my website, and give me the connection details privately. Update my setup instructions, then walk me through the iPhone steps.

Once setup is complete, open **Voice Inbox → Set up an iPhone Shortcut → Detailed iPhone setup steps** and use the connection details provided by AI. Save each recording to Files before uploading, then review its proposals in Voice Inbox.

<details>
<summary>Configuration reference for the person or AI setting up the site</summary>

Generate the token with a cryptographically secure random generator, such as `openssl rand -hex 32`. Store it as the server's `SHORTCUT_UPLOAD_TOKEN` and use the same value for the Shortcut's `X-Next-Up-Token` header. Set `SHORTCUT_OWNER_ID` to the owner's authenticated account ID and use the site's URL ending in `/api/shortcut-upload`. Configure any additional authorization header required by the hosting gateway.

Keep real tokens out of source files and public setup instructions. Provide connection values privately. This starter does not automatically generate tokens or reveal runtime credentials through a settings endpoint; the AI needs access to the deployment settings or must guide the owner through configuration.

</details>

## Source layout

- `app/`: UI, API routes, task state, planning, timeline, and voice processing.
- `db/schema.ts`: database definitions; `db/seed.sql`: fictional examples.
- `drizzle/`: a fresh initial schema and generation metadata.
- `worker/`: Worker entry and access checks.
- `tests/`: task, planning, timeline, voice, and public starter checks.

## License

[MIT](LICENSE).
