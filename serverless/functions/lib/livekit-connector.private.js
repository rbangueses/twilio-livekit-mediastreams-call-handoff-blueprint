const { LiveKitAPI, RoomAgentDispatch } = require("livekit-server-sdk");
const {
  ConnectTwilioCallRequest_TwilioCallDirection,
} = require("@livekit/protocol");

async function connectLiveKitCall(context, event, callback, options = {}) {
  const response = new Twilio.twiml.VoiceResponse();
  const missingFields = requiredFieldNames().filter((name) => isBlank(valueForField(context, event, name)));

  if (missingFields.length > 0) {
    console.error(`${options.logPrefix || "voice"}_config_missing`, { missingFields });
    response.say("Sorry, this phone line is temporarily unavailable. Please try again later.");
    return callback(null, response);
  }

  try {
    const api = createLiveKitApi(context);
    const connectorResponse = await api.connector.connectTwilioCall(
      buildConnectorRequest(context, event, options),
    );
    return callback(null, buildStreamTwiml(connectorResponse.connectUrl));
  } catch (error) {
    console.error(`${options.logPrefix || "voice"}_connect_twilio_call_failed`, {
      message: error.message,
    });
    response.say("Sorry, this phone line is temporarily unavailable. Please try again later.");
    return callback(null, response);
  }
}

function createLiveKitApi(context) {
  return new LiveKitAPI({
    host: context.LIVEKIT_URL,
    apiKey: context.LIVEKIT_API_KEY,
    secret: context.LIVEKIT_API_SECRET,
  });
}

function buildConnectorRequest(context, event, options = {}) {
  const parentCallSid = event.CallSid;
  const from = event.From || "unknown-caller";
  const route = options.route || "direct";
  const attributes = {
    parentCallSid,
    handoffId: event.HandoffId || parentCallSid,
    callDirection: "inbound",
    customerPhone: from,
    twilioTo: event.To || "",
    handoffRoute: route,
  };

  return {
    twilioCallDirection: ConnectTwilioCallRequest_TwilioCallDirection.INBOUND,
    roomName: `twilio-call-${parentCallSid}`,
    participantIdentity: `caller-${parentCallSid}`,
    participantName: from,
    participantAttributes: attributes,
    agents: [new RoomAgentDispatch({ agentName: context.LIVEKIT_AGENT_NAME })],
  };
}

function buildStreamTwiml(connectUrl) {
  if (isBlank(connectUrl) || !connectUrl.startsWith("wss://")) {
    throw new Error("connectUrl must be a wss:// URL");
  }

  const response = new Twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.stream({ url: connectUrl });
  return response.toString().replace(/^<\?xml[^>]*\?>/, "").replace("/>", " />");
}

function requiredFieldNames() {
  return ["CallSid", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_AGENT_NAME"];
}

function valueForField(context, event, name) {
  return name === "CallSid" ? event.CallSid : context[name];
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

module.exports = {
  buildConnectorRequest,
  buildStreamTwiml,
  connectLiveKitCall,
  createLiveKitApi,
};
