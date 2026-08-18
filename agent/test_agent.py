import asyncio
import unittest
from unittest.mock import Mock, patch

from agent.agent import build_escalation_payload, escalation_path_for_payload, post_escalation


class EscalationPayloadTests(unittest.TestCase):
    def test_build_escalation_payload_preserves_handoff_route(self) -> None:
        payload = build_escalation_payload(
            {
                "parentCallSid": "CA123",
                "handoffRoute": "support-tier-two",
            },
            intent="account_access",
            summary="Customer cannot sign in.",
        )

        self.assertEqual(payload["handoffRoute"], "support-tier-two")

    def test_post_escalation_posts_from_async_context(self) -> None:
        response = Mock()
        response.json.return_value = {"status": "accepted"}

        with patch("agent.agent.requests.post", return_value=response) as post:
            result = asyncio.run(
                post_escalation(
                    "https://handoff.example.test",
                    "token",
                    {"parentCallSid": "CA123"},
                    path="/escalate",
                )
            )

        self.assertEqual(result, {"status": "accepted"})
        post.assert_called_once()

    def test_escalation_path_uses_trusted_connector_route(self) -> None:
        self.assertEqual(
            escalation_path_for_payload({"handoffRoute": "studio"}, "/escalate"),
            "/studio_escalate",
        )
        self.assertEqual(
            escalation_path_for_payload({"handoffRoute": "direct"}, "/studio_escalate"),
            "/escalate",
        )

    def test_escalation_path_falls_back_for_unrecognized_connector_route(self) -> None:
        self.assertEqual(
            escalation_path_for_payload({"handoffRoute": "support-tier-two"}, "/configured"),
            "/configured",
        )
        self.assertEqual(escalation_path_for_payload({}, "/configured"), "/configured")


if __name__ == "__main__":
    unittest.main()
