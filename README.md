# Twilio LiveKit Media Streams Call Handoff

This repo is a milestone 1 blueprint for handing an active Twilio phone call from a LiveKit voice agent back to Twilio, then routing the caller to Flex.

It uses LiveKit Twilio Connector and Twilio Media Streams:

- Twilio receives the phone call.
- Twilio Functions call LiveKit `ConnectTwilioCall`.
- LiveKit returns a `connect_url`.
- Twilio connects the call to that WebSocket with `<Connect><Stream>`.
- The LiveKit agent reads connector participant attributes.
- The agent calls a protected Twilio Function when it needs to escalate.
- Twilio updates the original parent CallSid into Flex.

For the SIP-based version, use `twilio-livekit-sip-call-handoff-blueprint`.

> Proof of concept. Adapt routing, authentication, observability, compliance, prompts, and error handling before production use.

## Patterns

### Pattern A: Studio Return

Studio owns the voice journey. A TwiML Redirect widget sends the caller to `/studio_voice`. When the LiveKit agent escalates, `/studio_escalate` redirects the parent call back to the Studio Flow webhook with `FlowEvent=return`. Studio then uses Send to Flex.

### Pattern B: Direct TaskRouter/Flex

The Twilio number points directly to `/voice`. When the LiveKit agent escalates, `/escalate` updates the parent call with `<Enqueue workflowSid="WW...">`.

## Shared Setup

Install the Twilio CLI and serverless plugin:

```bash
twilio login
twilio plugins:install @twilio-labs/plugin-serverless
```

Create the serverless environment:

```bash
cd serverless
cp .env.example .env
```

Fill in:

```text
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_AGENT_NAME=inbound-agent-code
FLEX_WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
STUDIO_FLOW_WEBHOOK_URL=https://webhooks.twilio.com/v1/Accounts/AC.../Flows/FW...
HANDOFF_TOKEN=replace_with_a_long_random_token
```

Deploy Functions:

```bash
npm install
npm run deploy
```

## Pattern A: Studio

Import `studio/livekit-flex-handoff-flow.example.json` or recreate the same flow manually:

```text
Incoming Call -> TwiML Redirect /studio_voice -> Send to Flex
```

Set the TwiML Redirect URL to your deployed `/studio_voice` Function.

Set `STUDIO_FLOW_WEBHOOK_URL` to the published Studio Flow webhook URL and redeploy Functions.

Configure the LiveKit agent with:

```text
HANDOFF_SERVICE_URL=https://your-functions-service-1234.twil.io
HANDOFF_TOKEN=replace_with_a_long_random_token
HANDOFF_ESCALATE_PATH=/studio_escalate
```

## Pattern B: Direct Flex Enqueue

Configure the Twilio number Voice webhook:

```text
POST https://your-functions-service-1234.twil.io/voice
```

Configure the LiveKit agent with:

```text
HANDOFF_SERVICE_URL=https://your-functions-service-1234.twil.io
HANDOFF_TOKEN=replace_with_a_long_random_token
HANDOFF_ESCALATE_PATH=/escalate
```

## Agent

The Python sample is in `agent/agent.py`. It looks for a LiveKit Connector participant and reads these attributes:

- `parentCallSid`
- `handoffId`
- `callDirection`
- `customerPhone`

It does not look for SIP participant attributes.

## Test

Run serverless unit tests:

```bash
cd serverless
npm test
```

Run the Python syntax check:

```bash
agent/.venv/bin/python -m py_compile agent/agent.py
```

Manual milestone 1 checks:

1. Direct inbound reaches LiveKit through Media Streams.
2. Direct inbound escalation creates a Flex task with context.
3. Studio inbound reaches LiveKit through Media Streams.
4. Studio inbound escalation returns to Studio and reaches Flex with context.

## Deferred

- Outbound calls.
- Conversation Memory.
- Custom TwiML routing.
- Published overview page.
- Flex Task Attributes Viewer documentation.
