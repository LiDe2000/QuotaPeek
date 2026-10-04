import importlib.util
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location(
    "fake_official", Path(__file__).with_name("app.py")
)
if spec is None or spec.loader is None:
    raise ImportError("Could not load the fake official activity service.")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MockTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(module.create_app())
        self.addCleanup(self.client.close)

    def test_claim_and_account_isolation(self):
        def query(account):
            return self.client.get(
                "/mock/workbuddy/status", params={"account_id": account}
            ).json()["data"]["state"]

        self.assertEqual(query("preview-wb-0"), "available")
        self.client.post("/mock/workbuddy/claim", json={"account_id": "preview-wb-0"})
        self.assertEqual(query("preview-wb-0"), "claimed")
        self.assertEqual(query("preview-wb-2"), "available")

    def test_real_accounts_and_credentials_are_rejected(self):
        self.assertEqual(
            self.client.get(
                "/mock/workbuddy/status", params={"account_id": "real"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                "/mock/workbuddy/status", params={"account_id": "preview-zc-0"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                "/mock/workbuddy/status",
                params={"account_id": "preview-wb-0"},
                headers={"Authorization": "Bearer sentinel"},
            ).status_code,
            400,
        )

    def test_uncertain_and_verification_results_are_not_success(self):
        result = self.client.post(
            "/mock/workbuddy/claim", json={"account_id": "preview-wb-2"}
        ).json()
        self.assertEqual(result["data"]["state"], "pending")
        result = self.client.post(
            "/mock/zcode/claim", json={"account_id": "preview-zc-1"}
        ).json()
        self.assertEqual(result["data"]["state"], "verification")


if __name__ == "__main__":
    unittest.main()
