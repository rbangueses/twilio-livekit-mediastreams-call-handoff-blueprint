const { normalizedSummary } = require("./escalation.private");

async function handleStudioEscalation(context, event, callback) {
  const response = jsonResponse();
  const authorization = event.request?.headers?.authorization || event.request?.headers?.Authorization;

  if (authorization !== `Bearer ${context.HANDOFF_TOKEN}`) {
    response.setStatusCode(401);
    response.setBody({ error: "unauthorized" });
    return callback(null, response);
  }

  const payload = parsePayload(event);
  const parentCallSid = payload.parentCallSid || payload.callSid;

  if (!parentCallSid) {
    response.setStatusCode(400);
    response.setBody({ error: "missing_parent_call_sid" });
    return callback(null, response);
  }

  if (isBlank(context.STUDIO_FLOW_WEBHOOK_URL)) {
    response.setStatusCode(500);
    response.setBody({ error: "missing_studio_flow_webhook_url" });
    return callback(null, response);
  }

  const summary = normalizedSummary(payload);
  const returnUrl = buildStudioReturnUrl(context.STUDIO_FLOW_WEBHOOK_URL, {
    parentCallSid,
    handoffId: payload.handoffId,
    customerPhone: payload.customerPhone,
    intent: payload.intent,
    summary,
    description: payload.description || summary,
  });
  const redirectTwiml = buildRedirectTwiml(returnUrl);

  try {
    await context.getTwilioClient().calls(parentCallSid).update({
      twiml: redirectTwiml.toString(),
    });
  } catch (error) {
    response.setStatusCode(502);
    response.setBody({
      error: "call_update_failed",
      message: error.message,
    });
    return callback(null, response);
  }

  response.setBody({ ok: true, parentCallSid, returnUrl });
  return callback(null, response);
}

function buildStudioReturnUrl(baseUrl, fields) {
  const url = new URL(baseUrl);
  url.searchParams.set("FlowEvent", "return");
  for (const [key, value] of Object.entries(fields)) {
    if (!isBlank(value)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildRedirectTwiml(returnUrl) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.redirect({ method: "POST" }, returnUrl);
  return twiml;
}

function jsonResponse() {
  const response = typeof Twilio.Response === "function" ? new Twilio.Response() : localResponse();
  response.appendHeader("Content-Type", "application/json");
  response.setStatusCode(200);
  return response;
}

function localResponse() {
  return {
    appendHeader(name, value) {
      this.headers = { ...this.headers, [name]: value };
    },
    setBody(body) {
      this.body = body;
    },
    setStatusCode(statusCode) {
      this.statusCode = statusCode;
    },
  };
}

function parsePayload(event) {
  if (typeof event.body === "string" && event.body.trim()) {
    try {
      return { ...event, ...JSON.parse(event.body) };
    } catch {
      return event;
    }
  }
  return event;
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

module.exports = {
  buildRedirectTwiml,
  buildStudioReturnUrl,
  handleStudioEscalation,
};
