# Twilio LiveKit Media Streams Call Handoff Blueprint

Conversational AI agents need a clean path to escalate to a human when they cannot resolve an interaction on their own.

This repo is a working blueprint for handing an active Twilio phone call from a LiveKit voice agent back to Twilio, then routing that caller to Twilio Flex with context. The core pattern is broader: keep Twilio as the call owner, pass the original parent `CallSid` into LiveKit through the Twilio Connector, let the LiveKit agent decide when to escalate, then update that original Twilio Call resource with the next TwiML instruction.

This blueprint intentionally uses LiveKit Twilio Connector and Twilio Media Streams. It does not use LiveKit SIP trunks, SIP dispatch rules, or SIP participant headers. For the SIP version, use `twilio-livekit-sip-call-handoff-blueprint`.

Flex is the reference human-agent destination in this repo. Pattern A uses Studio to resume the journey and then Send to Flex. Pattern B sends the caller directly to TaskRouter/Flex with `<Enqueue>`. The same parent-call update pattern can be adapted to another TaskRouter-powered contact center or a custom TwiML destination.

The repo includes two inbound handoff paths. The Studio path has been exercised end to end, and the direct TaskRouter path is implemented with unit coverage around the same parent-call update mechanics:

- **Studio path:** Twilio number starts a Studio Flow, Studio calls `/studio_voice`, Twilio connects the caller to LiveKit with `<Connect><Stream>`, the LiveKit hosted agent calls `/studio_escalate`, and the call returns to the same Studio execution before Send to Flex.
- **TaskRouter path:** Twilio number calls `/voice`, Twilio connects the caller to LiveKit with `<Connect><Stream>`, the LiveKit hosted agent calls `/escalate`, and the original parent call is updated with `<Enqueue>` for Flex or another TaskRouter-powered contact center.

> **Proof of concept.** This blueprint is intended as a working reference implementation, not a production drop-in. Before using it in production, adapt the routing, authentication, prompts, observability, error handling, security controls, data-retention behavior, and compliance posture to your use case.

## Index

- [1. Prerequisites](#1-prerequisites)
- [2. Choose the Escalation Pattern](#2-choose-the-escalation-pattern)
  - [2.1 Function Paths](#21-function-paths)
- [3. Shared Setup](#3-shared-setup)
  - [3.1 Deploy the Twilio Functions](#31-deploy-the-twilio-functions)
  - [3.2 Configure the LiveKit Hosted Agent](#32-configure-the-livekit-hosted-agent)
  - [3.3 Configure the Twilio Number](#33-configure-the-twilio-number)
- [4. Pattern A Setup: Using Studio](#4-pattern-a-setup-using-studio)
- [5. Pattern B Setup: Using TaskRouter](#5-pattern-b-setup-using-taskrouter)
- [6. How the Patterns Target the Right Call](#6-how-the-patterns-target-the-right-call)
- [7. Test End to End](#7-test-end-to-end)
- [8. Display Task Attributes in Flex](#8-display-task-attributes-in-flex)
- [9. Local Checks](#9-local-checks)
- [10. Troubleshooting](#10-troubleshooting)

## 1. Prerequisites

You need:

- A Twilio account.
- A Twilio phone number for inbound calls.
- A LiveKit Cloud project with Twilio Connector access.
- A LiveKit hosted agent, or enough hosted-agent quota to create one.
- The LiveKit CLI if you want to deploy the hosted agent from the terminal.
- The Twilio CLI if you want to deploy the Functions from this repo.
- Node.js 18 or newer for the Twilio Functions project.
- Python 3.13 or newer for the LiveKit agent project.

For the tested TaskRouter/Flex paths, you also need:

- Flex enabled in the Twilio account, or another TaskRouter-powered contact center.
- The TaskRouter Workflow SID that should receive escalated voice tasks. This must start with `WW`; do not use a Studio Flow SID (`FW...`) or a TaskRouter Workspace SID (`WS...`).
- For Pattern A, a Studio Flow with a TwiML Redirect widget and a Send to Flex widget.

Install and authenticate the Twilio CLI:

```bash
twilio login
twilio plugins:install @twilio-labs/plugin-serverless
```

Install and authenticate the LiveKit CLI:

```bash
lk cloud auth
```

Choose this secret yourself:

- `HANDOFF_TOKEN`: shared by the LiveKit agent and the protected Twilio Functions it calls.

For example:

```bash
openssl rand -base64 32
```

## 2. Choose the Escalation Pattern

Use **Pattern A** when the Twilio number already starts in Studio, or when you want Studio to own the IVR, branching, reporting, and final Send to Flex widget. This is the path currently validated end to end for this repo.

Use **Pattern B** when you want the smallest direct TaskRouter handoff: a Twilio Function connects the caller to LiveKit, and the LiveKit tool updates the parent call with `<Enqueue>`.

Use a **custom TwiML adaptation** when the LiveKit agent should route the caller somewhere that does not use TaskRouter. The parent call SID mechanics stay the same, but the handoff endpoint should return a different TwiML instruction such as `<Dial>`, `<Conference>`, `<Sip>`, or `<Redirect>`.

> **Context payload extension point.** This reference implementation passes concise handoff context inline as Studio or TaskRouter task attributes. In production, keep those attributes short. If the payload grows, store the full context in an external datastore keyed by `handoffId`, `parentCallSid`, or another correlation ID, then pass only the identifier downstream.

### 2.1 Function Paths

The repo includes these Function paths:

- [serverless/functions/studio_voice.js](serverless/functions/studio_voice.js): Pattern A entrypoint called by the Studio TwiML Redirect widget.
- [serverless/functions/studio_escalate.js](serverless/functions/studio_escalate.js): Pattern A handoff endpoint called by the LiveKit agent tool.
- [serverless/functions/voice.js](serverless/functions/voice.js): Pattern B entrypoint called directly by the Twilio number webhook.
- [serverless/functions/escalate.js](serverless/functions/escalate.js): Pattern B handoff endpoint called by the LiveKit agent tool.

A single Twilio phone number can be pointed at one incoming voice target at a time. To test Pattern A, route the number to the Studio Flow webhook. To test Pattern B, route the number directly to `/voice`.

The LiveKit agent can choose the handoff endpoint from the connector-provided `handoffRoute` attribute:

- `handoffRoute=studio` calls `/studio_escalate`.
- `handoffRoute=direct` calls `/escalate`.
- Any other route falls back to `HANDOFF_ESCALATE_PATH`.

## 3. Shared Setup

### 3.1 Deploy the Twilio Functions

Create the deployment env file:

```bash
cp serverless/.env.example serverless/.env
```

Fill in `serverless/.env`:

```text
TWILIO_SERVERLESS_SERVICE_NAME=livekit-mediastreams-handoff
TWILIO_PROFILE=
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=replace_with_twilio_auth_token
TWILIO_PHONE_NUMBER=+15551234567

LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=replace_with_livekit_api_key
LIVEKIT_API_SECRET=replace_with_livekit_api_secret
LIVEKIT_AGENT_NAME=mediastreams-inbound-agent

FLEX_WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FLEX_WAIT_URL=

STUDIO_FLOW_WEBHOOK_URL=https://webhooks.twilio.com/v1/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Flows/FWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

HANDOFF_TOKEN=replace_with_long_random_token
```

`FLEX_WORKFLOW_SID` is required for Pattern B and for the Studio Send to Flex widget. `STUDIO_FLOW_WEBHOOK_URL` is required for Pattern A. If you create the Studio Flow after the first Function deployment, add the Flow webhook URL to `serverless/.env` and deploy again.

Deploy:

```bash
cd serverless
npm install
npm run deploy
```

The deploy script validates the required variables, checks that `FLEX_WORKFLOW_SID` looks like a `WW...` Workflow SID, and runs:

```bash
twilio serverless:deploy --service-name "$TWILIO_SERVERLESS_SERVICE_NAME" --env .env --override-existing-project
```

If `TWILIO_PROFILE` is set, the deploy script passes `-p <profile>` to the Twilio CLI. Use this when the phone number/Flex account is not your active Twilio CLI profile.

The deployment produces these public Function URLs:

```text
https://your-functions-service-1234.twil.io/studio_voice
https://your-functions-service-1234.twil.io/studio_escalate
https://your-functions-service-1234.twil.io/voice
https://your-functions-service-1234.twil.io/escalate
```

### 3.2 Configure the LiveKit Hosted Agent

The Python sample is in [agent/agent.py](agent/agent.py). It uses LiveKit hosted-agent primitives:

- `AgentServer` and `@server.rtc_session(...)`.
- LiveKit inference for STT, LLM, TTS, and turn detection.
- `silero` VAD.
- A `transfer_to_flex` function tool that calls the protected Twilio handoff Function.

Create the local agent env file:

```bash
cp agent/.env.local.example agent/.env.local
```

Fill in `agent/.env.local` for local development:

```text
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=replace_with_livekit_api_key
LIVEKIT_API_SECRET=replace_with_livekit_api_secret
LIVEKIT_AGENT_NAME=mediastreams-inbound-agent

HANDOFF_SERVICE_URL=https://your-functions-service-1234.twil.io
HANDOFF_TOKEN=replace_with_long_random_token
HANDOFF_ESCALATE_PATH=/studio_escalate
```

Use `/studio_escalate` for Pattern A and `/escalate` for Pattern B. The connector `handoffRoute` still takes precedence for the standard Studio and direct routes.

For a clean hosted deployment, create a dedicated hosted agent for this blueprint and use the same name in both places:

```text
LIVEKIT_AGENT_NAME=mediastreams-inbound-agent
```

If your LiveKit project has only one hosted-agent slot and you temporarily reuse an existing hosted SIP agent, set `LIVEKIT_AGENT_NAME` to that existing agent name in both `serverless/.env` and the hosted agent secrets. This is useful for one-by-one testing, but it displaces the SIP integration until you redeploy or roll back that hosted agent.

If you use a LiveKit CLI config file, create a local copy from the template and fill in your project values:

```bash
cp agent/livekit.example.toml agent/livekit.toml
```

`agent/livekit.toml` is local deployment state. It should point at the LiveKit project and hosted agent ID you are actively deploying to.

Deploy or update the hosted agent with the LiveKit CLI:

```bash
cd agent
lk agent deploy --secrets-file .env.local
```

After changing the agent source, tool definitions, prompt, `LIVEKIT_AGENT_NAME`, or `HANDOFF_ESCALATE_PATH`, redeploy or restart the LiveKit agent runtime. Twilio Function and Studio changes do not update an already-running LiveKit agent process.

For the current test flow, the bundled agent prompt does this:

```text
First, help the caller with one practical self-service step for account access.
If the caller says it still is not working, asks for a person, or sounds blocked, briefly say that you are connecting them to a support specialist. Then call transfer_to_flex with intent account_access and a concise summary.
```

### 3.3 Configure the Twilio Number

For Pattern A, configure the Twilio number Voice webhook to the published Studio Flow webhook with `POST`.

For Pattern B, configure the Twilio number Voice webhook directly to:

```text
POST https://your-functions-service-1234.twil.io/voice
```

Do not point this Media Streams blueprint at a LiveKit SIP trunk. The Twilio Functions call LiveKit `ConnectTwilioCall`, then return `<Connect><Stream>` using the connector `connectUrl`.

## 4. Pattern A Setup: Using Studio

Pattern A keeps Studio in control of the inbound voice journey. Studio sends the caller to LiveKit only for the AI agent portion, then resumes the same Studio execution when the LiveKit agent escalates.

The call flow is:

1. Caller dials your Twilio number.
2. Twilio starts the Studio Flow.
3. Studio enters a TwiML Redirect widget named `redirect_to_livekit`.
4. The TwiML Redirect widget calls `/studio_voice`.
5. `/studio_voice` calls LiveKit `ConnectTwilioCall` with `handoffRoute=studio`, then returns `<Connect><Stream>` to Twilio.
6. The LiveKit hosted agent joins the room and talks to the caller.
7. The LiveKit agent calls `/studio_escalate` when it needs a human.
8. `/studio_escalate` updates the original Twilio Call resource with `<Redirect>` back to the Studio Flow webhook using `FlowEvent=return`.
9. Studio resumes on the TwiML Redirect widget's `return` transition.
10. Studio uses Send to Flex to create the Flex voice task.

### 4.1 Create or Import the Studio Flow

This repo includes a share-safe Studio Flow template at [studio/livekit-flex-handoff-flow.example.json](studio/livekit-flex-handoff-flow.example.json).

The sample flow has this shape:

```text
Trigger: Incoming Call
  -> TwiML Redirect: redirect_to_livekit
      return -> Send to Flex: send_to_flex
```

Before publishing, replace:

- The TwiML Redirect URL with your deployed `/studio_voice` Function URL.
- The Send to Flex `workflow` value with your `WW...` TaskRouter Workflow SID.
- The Send to Flex `channel` value with the Flex voice `TC...` Task Channel SID from your account.

The Send to Flex widget passes these handoff fields into the Flex task attributes:

- `intent`
- `summary`
- `description`
- `parentCallSid`
- `handoffId`
- `customerPhone`

After publishing the Flow, copy the Flow webhook URL into `serverless/.env` as `STUDIO_FLOW_WEBHOOK_URL`, redeploy Twilio Functions, then point the Twilio number at the Studio Flow webhook.

## 5. Pattern B Setup: Using TaskRouter

Pattern B is the smaller direct route. Twilio points the phone number straight at `/voice`, and the LiveKit agent calls `/escalate` when it needs a human.

The call flow is:

1. Caller dials your Twilio number.
2. Twilio calls `/voice`.
3. `/voice` calls LiveKit `ConnectTwilioCall` with `handoffRoute=direct`, then returns `<Connect><Stream>` to Twilio.
4. The LiveKit hosted agent joins the room and talks to the caller.
5. The LiveKit agent calls `/escalate` when it needs a human.
6. `/escalate` updates the original Twilio Call resource with `<Enqueue workflowSid="WW...">`.
7. TaskRouter/Flex creates the voice task with the handoff context.

Configure the Twilio number Voice webhook:

```text
POST https://your-functions-service-1234.twil.io/voice
```

If you are testing only Pattern B, set the agent fallback path to:

```text
HANDOFF_ESCALATE_PATH=/escalate
```

## 6. How the Patterns Target the Right Call

The key handoff detail is the parent call SID.

When Twilio calls `/studio_voice` or `/voice`, Twilio sends the inbound caller's original `CallSid` to the Function. The Function passes that value into LiveKit `ConnectTwilioCall` as connector participant attributes:

```json
{
  "parentCallSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "handoffId": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "callDirection": "inbound",
  "customerPhone": "+15551234567",
  "handoffRoute": "studio"
}
```

The LiveKit agent reads the connector participant attributes. If the connector participant is not visible yet, the agent falls back to the job participant attributes. When the agent escalates, it updates the parent Twilio Call resource, not a LiveKit room ID, not a child media leg, and not a SIP participant.

## 7. Test End to End

Use these manual checks for Pattern A:

1. Call the Twilio number.
2. Confirm the Studio execution reaches the `redirect_to_livekit` widget.
3. Confirm the LiveKit hosted agent answers and can hear the caller.
4. Ask for a human or say that the self-service step did not work.
5. Confirm the agent says it is connecting the caller.
6. Confirm the Studio execution resumes through the TwiML Redirect `return` transition.
7. Confirm Send to Flex creates a voice task with `summary`, `intent`, `parentCallSid`, and `handoffId`.
8. Confirm the Flex agent can answer the live call.

Use these manual checks for Pattern B:

1. Point the Twilio number directly at `/voice`.
2. Call the Twilio number.
3. Confirm the LiveKit hosted agent answers and can hear the caller.
4. Ask for a human or say that the self-service step did not work.
5. Confirm Flex receives a voice task through the configured `WW...` Workflow.

You can also smoke test the protected Studio handoff endpoint after deployment:

```bash
curl -i https://your-functions-service-1234.twil.io/studio_escalate \
  -H "Authorization: Bearer replace_with_long_random_token" \
  -H "Content-Type: application/json" \
  -d '{"summary":"smoke test"}'
```

If the deployed module loads and auth is configured, the expected response is:

```json
{
  "error": "missing_parent_call_sid"
}
```

That response is useful because it proves `/studio_escalate` loaded successfully without updating a live call.

## 8. Display Task Attributes in Flex

The Studio and TaskRouter paths both pass handoff context into the voice task attributes. At minimum, surface these values in Flex or your custom agent desktop:

- `summary`
- `description`
- `intent`
- `customerPhone`
- `parentCallSid`
- `handoffId`

For production, decide which attributes should be visible to the human agent, which should be used only for routing, and which should live in an external datastore instead of TaskRouter attributes.

## 9. Local Checks

Run serverless unit tests:

```bash
cd serverless
npm test
cd ..
```

Run the Python agent tests:

```bash
agent/.venv/bin/python -m unittest agent.test_agent
```

From this workspace, the project currently has coverage for:

- `ConnectTwilioCall` request construction.
- Media Streams TwiML generation.
- Direct `/escalate` parent-call update.
- Studio `/studio_escalate` parent-call redirect.
- The Twilio Runtime packaging regression where `/studio_escalate` must not require `./escalation.private`.
- Agent connector attribute extraction and handoff route selection.

## 10. Troubleshooting

### Caller hears silence

Check that the hosted agent is running and that `LIVEKIT_AGENT_NAME` matches in both places:

- `serverless/.env`, used by `ConnectTwilioCall` agent dispatch.
- The hosted agent deployment secrets, used by `@server.rtc_session(agent_name=...)`.

Also confirm the deployed agent starts the `AgentSession` after `ctx.connect()` and does not wait indefinitely for a participant. The bundled agent uses connector attributes from the active room and falls back to job participant attributes.

### Agent says it is transferring, but nothing happens

Check the LiveKit agent logs for an HTTP error from `transfer_to_flex`, then check the Twilio Debugger for the matching Function error.

For Pattern A, the common checks are:

- `/studio_escalate` is deployed in the current Twilio Functions build.
- `HANDOFF_TOKEN` matches between the agent and Twilio Functions.
- `STUDIO_FLOW_WEBHOOK_URL` points to the published Studio Flow webhook.
- The Studio Flow has a `return` transition from `redirect_to_livekit` into Send to Flex.
- The Send to Flex widget has a valid `WW...` Workflow SID and `TC...` voice Task Channel SID.

For Pattern B, the common checks are:

- `/escalate` is deployed in the current Twilio Functions build.
- `FLEX_WORKFLOW_SID` is a `WW...` Workflow SID.
- Flex workers are online and eligible for the configured Workflow.

### Studio does not resume

Confirm `/studio_escalate` updates the original parent `CallSid` with a `<Redirect>` to the Studio Flow webhook and includes `FlowEvent=return`. If the handoff endpoint is accidentally set to `/escalate`, the call can still reach Flex, but Studio will be bypassed.

### SIP integration is affected during testing

This blueprint does not require SIP. If you temporarily reuse the same LiveKit hosted agent slot that another SIP integration uses, that hosted runtime is replaced until you redeploy or roll back the SIP agent. Use a dedicated hosted agent for this Media Streams blueprint when moving beyond one-by-one testing.

## Deferred

- Outbound calls.
- Conversation Memory.
- Custom TwiML routing examples.
- Published overview page.
- Flex Task Attributes Viewer documentation.
