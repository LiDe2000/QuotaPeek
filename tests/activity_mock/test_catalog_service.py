import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "catalog_service", ROOT / "activity-service/app.py"
)
if spec is None or spec.loader is None:
    raise ImportError("Could not load the activity configuration service.")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
create_app = module.create_app


class CatalogServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "activities.json"
        self.catalog = json.loads(
            (ROOT / "tests/activity_mock/activities.json").read_text(encoding="utf-8")
        )
        self.save()
        self.client = TestClient(create_app(self.path))
        self.addCleanup(self.client.close)

    def save(self):
        self.path.write_text(json.dumps(self.catalog), encoding="utf-8")

    def test_publishes_executable_config_and_has_no_account_or_claim_routes(self):
        response = self.client.get("/v1/activities")
        self.assertEqual(response.status_code, 200)
        activity = response.json()["activities"][0]
        self.assertIn("query", activity)
        self.assertIn("adapterId", activity)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(
            self.client.post(
                "/v1/activities/workbuddy-daily/accounts/preview-wb-0/claim"
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(
                "/v1/activities/workbuddy-daily/accounts/preview-wb-0/status"
            ).status_code,
            404,
        )

    def test_hot_reload_and_authoritative_empty_catalog(self):
        first = self.client.get("/v1/activities").json()["revision"]
        self.catalog["activities"] = []
        self.save()
        result = self.client.get("/v1/activities").json()
        self.assertEqual(result["activities"], [])
        self.assertNotEqual(result["revision"], first)

    def test_bad_config_is_not_published(self):
        self.catalog["activities"].append(self.catalog["activities"][0])
        self.save()
        self.assertEqual(self.client.get("/v1/activities").status_code, 503)
        self.path.write_text("{", encoding="utf-8")
        self.assertEqual(self.client.get("/v1/activities").status_code, 503)

    def test_missing_file_has_explicit_missing_response(self):
        self.path.unlink()
        self.assertEqual(self.client.get("/v1/activities").status_code, 404)


if __name__ == "__main__":
    unittest.main()
