const test = require("node:test");
const assert = require("node:assert/strict");

global.Twilio = require("twilio");

const {
  buildConnectorRequest,
  buildStreamTwiml,
} = require("../functions/lib/livekit-connector.private");

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
