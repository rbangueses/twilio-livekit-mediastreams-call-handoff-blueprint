async function handleEscalation(context, event, callback) {
  const response = jsonResponse();
  const authorization = event.request?.headers?.authorization || event.request?.headers?.Authorization;

  if (isBlank(context.HANDOFF_TOKEN)) {
    response.setStatusCode(500);
    response.setBody({ error: "missing_handoff_token" });
    return callback(null, response);
  }

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

  if (!isWorkflowSid(context.FLEX_WORKFLOW_SID)) {
    response.setStatusCode(500);
    response.setBody({
      error: "invalid_flex_workflow_sid",
      message: "FLEX_WORKFLOW_SID must be a TaskRouter Workflow SID that starts with WW.",
    });
    return callback(null, response);
  }

  const summary = normalizedSummary(payload);
  const taskAttributes = taskAttributesForPayload(payload, parentCallSid, summary);
  const enqueueTwiml = buildEnqueueTwiml(context, taskAttributes);

  try {
    await context.getTwilioClient().calls(parentCallSid).update({
      twiml: enqueueTwiml.toString(),
    });
  } catch (error) {
    response.setStatusCode(502);
    response.setBody({
      error: "call_update_failed",
      message: error.message,
    });
    return callback(null, response);
  }

  response.setBody({ ok: true, parentCallSid, taskAttributes });
  return callback(null, response);
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

function buildEnqueueTwiml(context, taskAttributes) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const enqueueAttrs = { workflowSid: context.FLEX_WORKFLOW_SID };

  if (context.FLEX_WAIT_URL) {
    enqueueAttrs.waitUrl = context.FLEX_WAIT_URL;
  }

  twiml.enqueue(enqueueAttrs).task(JSON.stringify(taskAttributes));
  return twiml;
}

function taskAttributesForPayload(payload, parentCallSid, summary) {
  return {
    direction: directionForPayload(payload),
    channelType: "voice",
    reason: "ai_escalation",
    name: payload.name || "LiveKit AI escalation",
    from: payload.from || payload.customerPhone,
    customerAddress: payload.customerPhone || payload.from,
    customerName: payload.customerPhone || payload.from,
    parentCallSid,
    handoffId: payload.handoffId,
    customerPhone: payload.customerPhone,
    intent: payload.intent,
    summary,
    description: payload.description || summary,
  };
}

function directionForPayload(payload) {
  return payload.direction === "outbound" || payload.callDirection === "outbound"
    ? "outbound"
    : "inbound";
}

function normalizedSummary(payload) {
  const fallback = "The LiveKit agent requested a human handoff.";
  const value =
    payload.summary ||
    payload.handoffSummary ||
    payload.escalationSummary ||
    payload.conversationSummary ||
    payload.description;

  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function isWorkflowSid(value) {
  return typeof value === "string" && /^WW[a-fA-F0-9]{32}$/.test(value);
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

module.exports = {
  buildEnqueueTwiml,
  handleEscalation,
  normalizedSummary,
  taskAttributesForPayload,
};
