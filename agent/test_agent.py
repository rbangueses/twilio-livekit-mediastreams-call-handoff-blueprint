import asyncio
import unittest
from unittest.mock import Mock, patch

from agent.agent import build_escalation_payload, post_escalation


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


if __name__ == "__main__":
    unittest.main()
