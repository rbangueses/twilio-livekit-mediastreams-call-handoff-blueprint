const test = require("node:test");
const assert = require("node:assert/strict");

global.Twilio = require("twilio");

const {
  buildConnectorRequest,
  buildStreamTwiml,
} = require("../functions/lib/livekit-connector.private");
const {
  handleEscalation,
  normalizedSummary,
  taskAttributesForPayload,
} = require("../functions/lib/escalation.private");
const {
  buildStudioReturnUrl,
  handleStudioEscalation,
} = require("../functions/lib/studio-escalation.private");

function baseContext(overrides = {}) {
  return {
    LIVEKIT_URL: "wss://example.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_AGENT_NAME: "inbound-agent-code",
    ...overrides,
  };
}

function inboundEvent(overrides = {}) {
  return {
    CallSid: "CA11111111111111111111111111111111",
    From: "+15551230000",
    To: "+15557654321",
    Direction: "inbound",
    ...overrides,
  };
}

test("buildConnectorRequest uses connector attributes for direct inbound", () => {
  const request = buildConnectorRequest(baseContext(), inboundEvent(), { route: "direct" });

  assert.equal(request.roomName, "twilio-call-CA11111111111111111111111111111111");
  assert.equal(request.participantIdentity, "caller-CA11111111111111111111111111111111");
  assert.equal(request.participantName, "+15551230000");
  assert.equal(request.participantAttributes.parentCallSid, "CA11111111111111111111111111111111");
  assert.equal(request.participantAttributes.handoffId, "CA11111111111111111111111111111111");
  assert.equal(request.participantAttributes.callDirection, "inbound");
  assert.equal(request.participantAttributes.customerPhone, "+15551230000");
  assert.equal(request.participantAttributes.handoffRoute, "direct");
  assert.equal(request.agents.length, 1);
  assert.equal(request.agents[0].agentName, "inbound-agent-code");
});

test("buildStreamTwiml returns bidirectional media stream TwiML", () => {
  const twiml = buildStreamTwiml("wss://connector.livekit.cloud/session");

  assert.match(twiml, /<Connect>/);
  assert.match(twiml, /<Stream url="wss:\/\/connector.livekit.cloud\/session" \/>/);
  assert.doesNotMatch(twiml, /\?/);
});

test("connectLiveKitCall returns polite TwiML fallback when config is missing", async () => {
  const { connectLiveKitCall } = require("../functions/lib/livekit-connector.private");
  const result = await invokeVoice(connectLiveKitCall, {}, inboundEvent(), { route: "direct" });

  assert.match(result.toString(), /temporarily unavailable/);
  assert.doesNotMatch(result.toString(), /<Stream/);
});

function invokeVoice(handler, context, event, options) {
  return new Promise((resolve, reject) => {
    handler(context, event, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    }, options);
  });
}

function invokeHandler(handler, context, event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function escalationContext(overrides = {}) {
  const updates = [];
  return {
    HANDOFF_TOKEN: "secret-token",
    FLEX_WORKFLOW_SID: "WW11111111111111111111111111111111",
    FLEX_WAIT_URL: "",
    getTwilioClient() {
      return {
        calls(callSid) {
          return {
            update(args) {
              updates.push({ callSid, args });
              return Promise.resolve({ sid: callSid });
            },
          };
        },
      };
    },
    updates,
    ...overrides,
  };
}

test("normalizedSummary uses fallback when summary is blank", () => {
  assert.equal(
    normalizedSummary({ summary: "   " }),
    "The LiveKit agent requested a human handoff.",
  );
});

test("taskAttributesForPayload includes Flex handoff context", () => {
  const attrs = taskAttributesForPayload(
    {
      callDirection: "inbound",
      handoffId: "handoff-1",
      customerPhone: "+15551230000",
      intent: "account_access",
    },
    "CA11111111111111111111111111111111",
    "Caller needs help signing in.",
  );

  assert.equal(attrs.direction, "inbound");
  assert.equal(attrs.channelType, "voice");
  assert.equal(attrs.reason, "ai_escalation");
  assert.equal(attrs.parentCallSid, "CA11111111111111111111111111111111");
  assert.equal(attrs.handoffId, "handoff-1");
  assert.equal(attrs.customerPhone, "+15551230000");
  assert.equal(attrs.intent, "account_access");
  assert.equal(attrs.summary, "Caller needs help signing in.");
});

test("handleEscalation rejects invalid bearer token", async () => {
  const result = await invokeHandler(handleEscalation, escalationContext(), {
    request: { headers: { authorization: "Bearer wrong" } },
  });

  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("handleEscalation rejects Bearer undefined when handoff token is missing", async () => {
  const context = escalationContext({ HANDOFF_TOKEN: "" });
  const result = await invokeHandler(handleEscalation, context, {
    request: { headers: { authorization: "Bearer undefined" } },
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "missing_handoff_token" });
  assert.equal(context.updates.length, 0);
});

test("handleEscalation updates parent call with enqueue TwiML", async () => {
  const context = escalationContext();
  const result = await invokeHandler(handleEscalation, context, {
    request: { headers: { authorization: "Bearer secret-token" } },
    parentCallSid: "CA11111111111111111111111111111111",
    handoffId: "handoff-1",
    callDirection: "inbound",
    customerPhone: "+15551230000",
    intent: "account_access",
    summary: "Caller needs help signing in.",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(context.updates[0].callSid, "CA11111111111111111111111111111111");
  assert.match(context.updates[0].args.twiml, /<Enqueue workflowSid="WW11111111111111111111111111111111">/);
  assert.match(context.updates[0].args.twiml, /Caller needs help signing in\./);
});

function studioContext(overrides = {}) {
  const updates = [];
  return {
    HANDOFF_TOKEN: "secret-token",
    STUDIO_FLOW_WEBHOOK_URL: "https://webhooks.twilio.com/v1/Accounts/AC11111111111111111111111111111111/Flows/FW11111111111111111111111111111111",
    getTwilioClient() {
      return {
        calls(callSid) {
          return {
            update(args) {
              updates.push({ callSid, args });
              return Promise.resolve({ sid: callSid });
            },
          };
        },
      };
    },
    updates,
    ...overrides,
  };
}

test("buildStudioReturnUrl appends FlowEvent return and handoff fields", () => {
  const url = buildStudioReturnUrl("https://webhooks.twilio.com/v1/Accounts/AC/Flows/FW", {
    parentCallSid: "CA11111111111111111111111111111111",
    handoffId: "handoff-1",
    customerPhone: "+15551230000",
    intent: "account_access",
    summary: "Needs help signing in.",
    description: "Caller tried a code.",
  });

  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("FlowEvent"), "return");
  assert.equal(parsed.searchParams.get("parentCallSid"), "CA11111111111111111111111111111111");
  assert.equal(parsed.searchParams.get("handoffId"), "handoff-1");
  assert.equal(parsed.searchParams.get("customerPhone"), "+15551230000");
  assert.equal(parsed.searchParams.get("intent"), "account_access");
  assert.equal(parsed.searchParams.get("summary"), "Needs help signing in.");
  assert.equal(parsed.searchParams.get("description"), "Caller tried a code.");
});

test("handleStudioEscalation redirects parent call to Studio return", async () => {
  const context = studioContext();
  const result = await invokeHandler(handleStudioEscalation, context, {
    request: { headers: { authorization: "Bearer secret-token" } },
    parentCallSid: "CA11111111111111111111111111111111",
    handoffId: "handoff-1",
    customerPhone: "+15551230000",
    intent: "account_access",
    summary: "Needs help signing in.",
    description: "Caller tried a code.",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(context.updates[0].callSid, "CA11111111111111111111111111111111");
  assert.match(context.updates[0].args.twiml, /<Redirect method="POST">/);
  assert.match(context.updates[0].args.twiml, /FlowEvent=return/);
});

test("handleStudioEscalation rejects Bearer undefined when handoff token is missing", async () => {
  const context = studioContext({ HANDOFF_TOKEN: "   " });
  const result = await invokeHandler(handleStudioEscalation, context, {
    request: { headers: { authorization: "Bearer undefined" } },
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "missing_handoff_token" });
  assert.equal(context.updates.length, 0);
});
